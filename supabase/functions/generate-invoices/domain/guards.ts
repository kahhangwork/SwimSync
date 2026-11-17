// The billing engine's guards, moved verbatim out of generateForTenant
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B4): not-ended month, auto switch, unreadable
// settings, suspended, auto-disabled, sealed month, ordering guard, run day — in
// this order, which is the order they have always run in.
//
// NAMED PROHIBITIONS (plan §1): no guard is reworded, merged or reordered; no
// `force`, skip or override parameter is ever added to this function; no `return`
// becomes a `throw` (the cron loop has no per-tenant catch). A refusal is
// `{ stop: result }`; only the end of the function says `{ go }`, so the caller
// cannot proceed without passing every guard.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import {
  clampRunDay,
  dayOfMonthInTimeZone,
  previousBillingMonth,
} from "../dates.ts";
import { earliestBlockingEarlierMonth } from "../orderingGuard.ts";
import * as repo from "../dao/billing.repo.ts";
import type { GenerateOptions, GenerateResult } from "../types.ts";

/** What a run that passed every guard carries forward (the B4 slice contract:
 *  the only guard-block values read after it). */
export type GuardContext = {
  billingMonth: string;
  monthStart: string;
  monthEnd: string;
};

export type GuardOutcome = { stop: GenerateResult } | { go: GuardContext };

export async function runGuards(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: GenerateOptions,
  mode: "auto" | "manual",
  force: boolean,
  now: Date
): Promise<GuardOutcome> {
  // Billing month: explicit YYYY-MM, else the previous calendar month in the
  // app timezone (SGT by default). Derived via previousBillingMonth() rather
  // than new Date()'s local fields — Edge Functions run in UTC, which bills the
  // wrong month at the SGT day boundary (the 1am SGT cron is 17:00 UTC the day
  // before). See dates.ts.
  let billingMonth: string;
  if (opts.billing_month && /^\d{4}-\d{2}$/.test(opts.billing_month)) {
    billingMonth = opts.billing_month;
  } else {
    billingMonth = previousBillingMonth(now);
  }
  // ── A month that has not ENDED can never be billed ────────────────────────
  // Invoices cover one COMPLETE calendar month (PRD §5.5), and until this guard
  // existed nothing enforced it: the format check above was the only validation,
  // so an admin could select the current month and generate.
  //
  // What that did, and why it is a hard refusal rather than a warning: the
  // completeness gate clamps its window to today (see `windowTo` below), which
  // is right for its own purpose — a lesson that has not happened yet is not a
  // gap. But it means a mid-month run sees only the lessons so far, judges the
  // month COMPLETE, bills them, and SEALS it. Every remaining lesson of that
  // month is then permanently unbillable: later runs short-circuit on the seal,
  // and the already-exists guard skips the parent even if it is reopened. A
  // silent, irreversible underbill — the §8a.1 / §7.18 family, one door along.
  //
  // Placed BEFORE the sealed-month guard so `force` cannot reach it. `force`
  // means exactly one thing — skip the sealed-month guard — and must not grow a
  // second meaning here: there is no legitimate case for billing an unfinished
  // month, so an override would only ever cause the loss described above.
  //
  // Derived from previousBillingMonth(), NOT hand-rolled month arithmetic: it
  // resolves the calendar month in APP_TIMEZONE, so at 00:30 SGT on 1 August
  // (16:30 UTC on 31 July) it correctly yields July. A UTC-derived comparison
  // would yield June here and REFUSE the month that is actually due — the same
  // SGT/UTC divergence as §7.7 and §7.12, pointing the other way.
  const latestBillableMonth = previousBillingMonth(now);
  if (billingMonth > latestBillableMonth) {
    return { stop: {
      tenant_id: tenantId,
      billing_month: billingMonth,
      status: "month_not_ended",
      message:
        `Cannot generate invoices for ${billingMonth}: that month has not ended yet. ` +
        `Invoices cover a whole calendar month, so the latest month that can be ` +
        `billed today is ${latestBillableMonth}.`,
    } };
  }

  const [by, bm] = billingMonth.split("-").map(Number);
  const monthStart = `${billingMonth}-01`;
  const lastDay = new Date(by, bm, 0).getDate();
  const monthEnd = `${billingMonth}-${String(lastDay).padStart(2, "0")}`;

  // ── Auto switch (auto mode only) ──────────────────────────────────────────
  // Per-tenant settings. app_settings held these globally, which meant one
  // school changing its run day changed everyone's.
  const { data: tenantRow, error: tenantErr } = await repo.readTenantSettings(supabase, tenantId);

  // ── Unreadable settings (auto mode only) ──────────────────────────────────
  // ⚠ FAIL CLOSED in auto mode when the tenant's settings cannot be read. The
  // run day below comes from this row; a swallowed error used to mean "use the
  // default", and on a billing schedule a default is an EARLY bill that then
  // seals the month (ENGINE_TENANT_RUN_DAY_PLAN.md, RISK 2). Return, never
  // throw: the cron loop has no per-tenant catch, so a throw would stop every
  // other tenant's billing. Manual runs ignore the schedule, so they proceed.
  if (mode === "auto" && (tenantErr || !tenantRow)) {
    return { stop: {
      tenant_id: tenantId,
      billing_month: billingMonth,
      status: "tenant_unreadable",
      message:
        `Could not read this business's billing settings` +
        (tenantErr ? `: ${tenantErr.message}` : " (no such business)") +
        `. Automatic generation skipped; it will retry on the next run.`,
    } };
  }

  // A suspended tenant gets no new invoicing at all — auto AND manual
  // (WAVE_5_PLAN.md chunk 3, decision 6). Existing receivables were the
  // owner's problem before suspension; already-sent public-invoice links
  // keep working (decision 8).
  if (tenantRow?.suspended_at) {
    return { stop: {
      tenant_id: tenantId,
      billing_month: billingMonth,
      status: "tenant_suspended",
      message:
        "This business is suspended. No invoices are generated while it is suspended.",
    } };
  }

  if (mode === "auto") {
    const enabled = tenantRow?.auto_invoice_enabled !== false;
    if (!enabled) {
      return { stop: {
        tenant_id: tenantId,
        billing_month: billingMonth,
        status: "auto_disabled",
        message:
          "Automatic invoice generation is turned off. Use manual generation from the admin panel.",
      } };
    }
  }

  // ── Sealed-month guard (skipped when forced) ──────────────────────────────
  if (!force) {
    const { data: billingPeriod } = await repo.readBillingPeriod(supabase, billingMonth, tenantId);

    if (billingPeriod) {
      return { stop: {
        tenant_id: tenantId,
        billing_month: billingMonth,
        status: "already_complete",
        message:
          "Invoices for this billing month were previously finalised. Skipping.",
      } };
    }
  }

  // ── Ordering guard: never seal a LATER month over an earlier unbilled one ──
  // orderingGuard.ts. Refuses to bill M while an EARLIER unsealed month still
  // has unbilled lessons, naming the earliest — because sealing M advances the
  // floor past that month and permanently strands its unmarked lessons (BACKLOG
  // "Sealing a LATER month strands an earlier unsealed one"; PRD §7.7 has no
  // override). Applies to manual, auto AND forced runs: there is no legitimate
  // out-of-order seal, so like the two guards above it takes no `force` bypass.
  // Placed here so a suspended/auto-disabled/sealed month still short-circuits
  // first. Read-only and fail-skippable — null on any uncertainty, never a
  // wrongful halt (RISK 1). In-order billing has no earlier unsealed month, so
  // this returns null and the run is byte-identical (RISK 3).
  const blockingEarlier = await earliestBlockingEarlierMonth(
    supabase,
    tenantId,
    billingMonth,
    now
  );
  if (blockingEarlier) {
    return { stop: {
      tenant_id: tenantId,
      billing_month: billingMonth,
      status: "earlier_month_unbilled",
      earlier_unbilled_month: blockingEarlier,
      message:
        `Cannot generate invoices for ${billingMonth}: an earlier month ` +
        `(${blockingEarlier}) still has lessons that are not billed yet. ` +
        `Bill ${blockingEarlier} first — billing a later month would seal it and ` +
        `permanently strand ${blockingEarlier}'s unmarked lessons.`,
    } };
  }

  // ── Run-day guard (automatic, non-forced runs only) ───────────────────────
  // Billing on the 1st is too early — the month's last lesson may not be
  // marked yet, and a lesson marked after the invoice exists is never added to
  // it. The automatic path therefore waits until a configured day of the
  // following month. Checked AFTER the sealed guard so a finished month
  // reports "already_complete" rather than "before_run_day".
  //
  // Manual/forced runs ignore this entirely: the admin generating on demand is
  // an explicit instruction and must never be blocked by a schedule.
  //
  // The run day is the BUSINESS's (tenants.invoice_run_day — the value the
  // Invoices page edits and the Billing months card reads). This guard read the
  // global app_settings key until 2026-09-24, so the card and the engine could
  // disagree about when a month is late (§8.117 RISK 9). tenantRow is non-null
  // here: auto mode returned tenant_unreadable above otherwise.
  if (mode === "auto" && !force) {
    const runDay = clampRunDay(tenantRow?.invoice_run_day);
    // Day-of-month in the APP timezone, never new Date().getDate() — that is
    // the UTC day and is a day behind in SGT before 08:00 (see dates.ts).
    const today = dayOfMonthInTimeZone(now);

    if (today < runDay) {
      return { stop: {
        tenant_id: tenantId,
        billing_month: billingMonth,
        status: "before_run_day",
        message:
          `Automatic invoices for ${billingMonth} are generated from day ${runDay} of the month. Today is day ${today}. Use manual generation to run now.`,
      } };
    }
  }

  return { go: { billingMonth, monthStart, monthEnd } };
}
