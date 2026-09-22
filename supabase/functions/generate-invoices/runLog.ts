// The generation run log — one billing_runs row per ATTEMPT, per tenant.
//
// Plan: docs/plans/BILLING_MONTHS_PLAN.md §5. The admin's Billing months card
// reads these rows to say WHEN a month was last generated and WHY it is still
// open. Before this existed, that reason was shown once on the Invoices page
// and then lost; the only durable record was the Edge Function log.
//
// Two properties are load-bearing:
//   • ATTEMPTS ONLY (⚠ RISK 3). An early return that did not try to bill —
//     before_run_day, auto_disabled, tenant_suspended, month_not_ended,
//     already_complete — writes nothing. Once cron is on, every daily tick
//     returns one of those per tenant; logging them would make every month
//     look "open" from the 1st and bury the real runs.
//   • BEST-EFFORT. recordRuns never throws. By the time it runs, invoices have
//     committed; a failed log write must never fail or undo billing. The cost
//     is that a broken write is silent — which is why the migration grants
//     service_role INSERT explicitly (⚠ RISK 1) and the tests assert the row
//     EXISTS, not merely that billing returned.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { GenerateOptions, GenerateResult } from "./core.ts";

/** Engine statuses that mean "did not attempt this month". Exported as the ONE
 *  place a new early-return status joins, so the log cannot drift from core.ts
 *  by someone remembering. */
export const NON_ATTEMPT_STATUSES: ReadonlySet<string> = new Set([
  "before_run_day",
  "auto_disabled",
  "tenant_suspended",
  "month_not_ended",
  "already_complete",
]);

/** ⚠ RISK 11: co-admins read this column. Message only, bounded. */
export const ERROR_MAX_CHARS = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RunRow = {
  tenant_id: string;
  billing_month: string;
  ran_by: string | null;
  mode: string | null;
  status: string;
  sealed: boolean;
  invoices_created: number;
  classes_still_incomplete: number | null;
  unclaimed_billable: number | null;
  earlier_unbilled_month: string | null;
  blocking: unknown[] | null;
  unclaimed_students: unknown[] | null;
  message: string | null;
  error: string | null;
};

/** Who pressed Generate. Only a well-formed UUID is kept: a malformed value
 *  would fail the insert's type check and lose the WHOLE row, which is worse
 *  than losing the name. NULL = the cron. */
function ranBy(opts: GenerateOptions): string | null {
  const id = opts.requested_by;
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

/**
 * Pure: the rows a run should write. One per tenant — a scoped (admin) run is
 * its own tenant's result; a cron run carries `per_tenant`. Entries with no
 * tenant_id, and every non-attempt status, produce nothing.
 */
export function toRunRows(result: GenerateResult, opts: GenerateOptions): RunRow[] {
  const runs = result.per_tenant ?? [result];
  return runs
    .filter((r) => !!r.tenant_id && !NON_ATTEMPT_STATUSES.has(r.status))
    .map((r) => ({
      tenant_id: r.tenant_id!,
      billing_month: r.billing_month,
      ran_by: ranBy(opts),
      mode: r.mode ?? opts.mode ?? null,
      status: r.status,
      sealed: r.sealed === true,
      invoices_created: r.invoices_created ?? 0,
      classes_still_incomplete: r.classes_still_incomplete ?? null,
      unclaimed_billable: r.unclaimed_billable ?? null,
      earlier_unbilled_month: r.earlier_unbilled_month ?? null,
      blocking: r.blocking?.length ? r.blocking : null,
      unclaimed_students: r.unclaimed_students?.length ? r.unclaimed_students : null,
      message: r.message ?? null,
      error: null,
    }));
}

/**
 * Pure: the row for a run that THREW. Only a scoped run can be attributed — a
 * cron-wide crash has no tenant to file it under (the function log covers it,
 * and cron is off). Returns [] when it cannot be attributed.
 */
export function toErrorRows(opts: GenerateOptions, e: unknown): RunRow[] {
  if (!opts.tenant_id || !opts.billing_month) return [];
  const msg = e instanceof Error ? e.message : String(e);
  return [
    {
      tenant_id: opts.tenant_id,
      billing_month: opts.billing_month,
      ran_by: ranBy(opts),
      mode: opts.mode ?? null,
      status: "error",
      sealed: false,
      invoices_created: 0,
      classes_still_incomplete: null,
      unclaimed_billable: null,
      earlier_unbilled_month: null,
      blocking: null,
      unclaimed_students: null,
      message: null,
      // ⚠ RISK 11: the message only — never a stack, never the raw object.
      error: msg.slice(0, ERROR_MAX_CHARS),
    },
  ];
}

/** Write the rows. Best-effort: NEVER throws; returns how many were written so
 *  a test can assert the write actually happened. */
export async function recordRuns(
  supabase: SupabaseClient,
  rows: RunRow[]
): Promise<{ recorded: number }> {
  if (!rows.length) return { recorded: 0 };
  try {
    const { error } = await supabase.from("billing_runs").insert(rows);
    if (error) {
      console.error("[runLog] billing_runs insert failed:", error.message);
      return { recorded: 0 };
    }
    return { recorded: rows.length };
  } catch (e) {
    console.error("[runLog] billing_runs insert threw:", (e as Error).message);
    return { recorded: 0 };
  }
}
