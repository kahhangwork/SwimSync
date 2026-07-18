// Supabase Edge Function: generate-invoices
//
// Thin HTTP wrapper: authenticates the caller, builds a service-role client,
// and delegates to generateInvoices() in core.ts (which holds all the billing
// logic and is exercised directly by core.test.ts).
//
//   • AUTO  (cron)   — POST {} (or {"mode":"auto"}). Runs daily via pg_cron.
//   • MANUAL (admin) — POST {"mode":"manual","force":true,"billing_month":"YYYY-MM"}.
//
// Request body (all optional):
//   mode          "auto" | "manual"   (default "auto")
//   force         boolean             (default false)
//   billing_month "YYYY-MM"           (default = previous calendar month in the
//                                      app timezone / SGT — see dates.ts)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateInvoices, type GenerateOptions } from "./core.ts";
import { emailCreatedInvoices, notifyGenerationBlocked } from "./email.ts";

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

  const supabase = createClient(
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

  try {
    const result = await generateInvoices(supabase, opts);

    // Generation refused: unmarked attendance. Nobody would otherwise find out
    // an unattended run did nothing, so tell the coaches what to mark. Throttled
    // to one alert per distinct set of blocking lessons — the cron runs daily.
    if (result.status === "incomplete_attendance") {
      const { notified } = await notifyGenerationBlocked(
        supabase,
        result.billing_month,
        (result.blocking ?? []).map((b) => ({
          class_title: b.class_title,
          session_date: b.session_date,
          unmarked_student_count: b.unmarked_student_count,
        })),
        { apiKey: Deno.env.get("RESEND_API_KEY") }
      );
      return json({ ...result, emails_sent: 0, blocked_alerts_sent: notified });
    }

    // Email each newly-created invoice (best-effort, after generation has
    // committed — see emailCreatedInvoices). Never throws; logged no-op when
    // RESEND_API_KEY is unset (local dev / tests).
    const { emailsSent } = await emailCreatedInvoices(supabase, result.created ?? [], {
      apiKey: Deno.env.get("RESEND_API_KEY"),
      appUrl: Deno.env.get("APP_URL"),
    });

    return json({ ...result, emails_sent: emailsSent });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
