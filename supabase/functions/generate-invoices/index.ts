// Supabase Edge Function: generate-invoices
//
// Thin HTTP wrapper: authenticates the caller, builds a service-role client,
// and delegates to generateInvoices() in core.ts (which holds all the billing
// logic and is exercised directly by core.test.ts).
//
//   • AUTO  (cron)   — POST {} (or {"mode":"auto"}). Runs daily via pg_cron.
//   • MANUAL (admin) — POST {"mode":"manual","force":true,"billing_month":"YYYY-MM"}.
//   • RESEND (admin) — POST {"resend_invoice_email":"<invoice uuid>"}. Re-sends ONE
//     invoice email and bills nothing. The admin route
//     (SwimSyncAdmin/app/api/resend-invoice-email) has already checked the caller
//     administers the invoice's business — CRON_SECRET only proves it came from
//     that route (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.2).
//
// Request body (all optional):
//   mode          "auto" | "manual"   (default "auto")
//   force         boolean             (default false)
//   billing_month "YYYY-MM"           (default = previous calendar month in the
//                                      app timezone / SGT — see dates.ts)

import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../_shared/database.overrides.ts";
import { generateInvoices, type GenerateOptions } from "./core.ts";
import { recordRuns, toErrorRows, toRunRows } from "./runLog.ts";
import { withDbNow } from "./clock.ts";
import {
  emailCreatedInvoices,
  notifyGenerationBlocked,
  resendInvoiceEmail,
  retryUnsentInvoiceEmails,
  shouldRetryTenantEmails,
} from "./email.ts";

/** One line per run in the Edge Function log — the timing record that also
 *  covers emails, which the run row cannot (it is written before them). */
function logTimings(
  result: { billing_month: string; tenant_id?: string; invoices_created?: number; timings_ms?: unknown; per_tenant?: unknown[] },
  timings: Record<string, number>
) {
  console.log(
    `[generate-invoices] timings ${JSON.stringify({
      billing_month: result.billing_month,
      tenant_id: result.tenant_id ?? null,
      invoices_created: result.invoices_created ?? 0,
      run_ms: timings,
      engine_ms: result.per_tenant ? undefined : result.timings_ms,
    })}`
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

Deno.serve(async (req: Request) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${Deno.env.get("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient<Database>(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // ── Parse options ─────────────────────────────────────────────────────────
  let opts: GenerateOptions = {};
  try {
    opts = await req.json();
  } catch {
    // empty body → defaults (auto mode, previous month)
  }

  // ── Resend one invoice email — no generation, no run-log row ──────────────
  const resendId = (opts as { resend_invoice_email?: unknown }).resend_invoice_email;
  if (resendId !== undefined) {
    if (typeof resendId !== "string" || !/^[0-9a-f-]{36}$/i.test(resendId)) {
      return json({ sent: false, reason: "bad request" }, 400);
    }
    // Never throws; a failed send is a 200 with a reason, like the other paths.
    return json(
      await resendInvoiceEmail(supabase, resendId, {
        apiKey: Deno.env.get("RESEND_API_KEY"),
        appUrl: Deno.env.get("APP_URL"),
      })
    );
  }

  // Run timing (BILLING ENGINE SPEED, 2026-11-16): generation is stored on the
  // run row (billing_runs.duration_ms); the email steps run AFTER that row is
  // written, so their times — and the total — are in the response and the log.
  const t0 = performance.now();
  const ms = (from: number) => Math.round(performance.now() - from);
  const emailMaxPerSecond = Number(Deno.env.get("RESEND_MAX_PER_SECOND")) || undefined;

  let blockedAlerts = 0;
  // Set once the run's own rows are written, so a failure LATER in the handler
  // (an alert or email step) cannot add an "error" row for a run that billed.
  let runRecorded = false;
  try {
    // The engine's "now" is the DATABASE's app_now() — the real clock on prod,
    // a driver's pinned moment locally (clock.ts, PIN_DRIVER_CLOCK_PLAN D3).
    // Inside the try so a failure records an error run for a scoped run.
    opts = await withDbNow(opts, supabase, { supabaseUrl: Deno.env.get("SUPABASE_URL") });
    const result = await generateInvoices(supabase, opts);
    const generateMs = ms(t0);

    // Record the attempt BEFORE any email: billing has committed, and a slow or
    // failing email step must not lose the record of what the run did. This is
    // also what lets the admin's Billing months card show the truth after a
    // client-side timeout. Best-effort — never throws (runLog.ts).
    await recordRuns(supabase, toRunRows(result, opts, generateMs));
    runRecorded = true;

    // Generation refused: unmarked attendance. Nobody would otherwise find out
    // an unattended run did nothing, so tell the coaches what to mark. Throttled
    // to one alert per distinct set of blocking lessons — the cron runs daily.
    // A run may cover ONE tenant (the admin button) or EVERY tenant (the cron),
    // so check both shapes. Each blocked tenant is alerted separately: a
    // combined email would tell one business about another's unmarked lessons.
    const blockedRuns = (result.per_tenant ?? [result]).filter(
      (r) => r.status === "incomplete_attendance"
    );

    if (blockedRuns.length) {
      let alerts = 0;
      for (const r of blockedRuns) {
        const { notified } = await notifyGenerationBlocked(
          supabase,
          r.billing_month,
          (r.blocking ?? []).map((b) => ({
            class_title: b.class_title,
            session_date: b.session_date,
            unmarked_student_count: b.unmarked_student_count,
          })),
          { apiKey: Deno.env.get("RESEND_API_KEY"), tenantId: r.tenant_id }
        );
        alerts += notified;
      }

      // A single-tenant run that is blocked produced no invoices at all, so
      // there is nothing to email; a multi-tenant run may still have billed
      // other tenants successfully and falls through to the email step below.
      if (!result.per_tenant) {
        const timings = { generate: generateMs, emails: 0, retry: 0, total: ms(t0) };
        logTimings(result, timings);
        return json({ ...result, emails_sent: 0, blocked_alerts_sent: alerts, run_timings_ms: timings });
      }
      blockedAlerts = alerts;
    }

    // Email each newly-created invoice (best-effort, after generation has
    // committed — see emailCreatedInvoices). Never throws; logged no-op when
    // RESEND_API_KEY is unset (local dev / tests).
    const emailEnv = {
      apiKey: Deno.env.get("RESEND_API_KEY"),
      appUrl: Deno.env.get("APP_URL"),
      maxPerSecond: emailMaxPerSecond,
    };
    const tEmails = performance.now();
    const { emailsSent } = await emailCreatedInvoices(
      supabase,
      result.created ?? [],
      emailEnv
    );

    // Self-heal pass: re-send any invoice email that never went out for the
    // month(s) just processed. Runs even when generation short-circuited
    // (already_complete) — that is the whole point (INVOICE_EMAIL_RETRY_PLAN.md).
    // Best-effort; retryUnsentInvoiceEmails never throws.
    //
    // ⚠ RISK 3: never email on behalf of a SUSPENDED tenant, nor an AUTO-DISABLED
    // tenant on an automatic run (a manual run for it is an explicit instruction).
    const emailsMs = ms(tEmails);
    const tRetry = performance.now();
    const isManual = opts.mode === "manual";
    let emailsRetried = 0;
    for (const run of result.per_tenant ?? [result]) {
      if (!run.tenant_id) continue;
      if (!shouldRetryTenantEmails(run.status, isManual)) continue;
      // ⚠ RISK 5: hold this run's freshly-created invoices out of the retry claim.
      const excludeIds = (run.created ?? []).map((c) => c.invoice_id);
      const { emailsRetried: n } = await retryUnsentInvoiceEmails(
        supabase,
        run.tenant_id,
        run.billing_month,
        { ...emailEnv, excludeIds }
      );
      emailsRetried += n;
    }

    const timings = { generate: generateMs, emails: emailsMs, retry: ms(tRetry), total: ms(t0) };
    logTimings(result, timings);
    return json({
      ...result,
      emails_sent: emailsSent,
      emails_retried: emailsRetried,
      blocked_alerts_sent: blockedAlerts,
      run_timings_ms: timings,
    });
  } catch (e) {
    // A scoped run that threw is still an attempt the admin must be able to
    // see ("last run failed: …"). recordRuns never throws, so this cannot mask
    // the original error.
    if (!runRecorded) await recordRuns(supabase, toErrorRows(opts, e, ms(t0)));
    return json({ error: (e as Error).message }, 500);
  }
});
