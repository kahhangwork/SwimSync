// The seal and the run's final result, moved verbatim out of generateForTenant
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B9).
//
// The FIVE conditions of `monthFinished` are the whole safety property of the seal
// (each explained below, in place). NAMED PROHIBITION: never add a condition-skip,
// a `force` arm or any override here — a wrong seal is a permanent underbill.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import * as repo from "../dao/billing.repo.ts";
import type { CreatedInvoice, GenerateResult, UnclaimedStudent } from "../types.ts";
import { timingsSince } from "./timings.ts";

export async function sealAndReport(
  supabase: SupabaseClient<Database>,
  c: {
    tenantId: string;
    billingMonth: string;
    mode: "auto" | "manual";
    force: boolean;
    classesComplete: number;
    classesIncomplete: number;
    deferredParents: ReadonlySet<string>;
    unclaimedBillable: number;
    unclaimedStudents: UnclaimedStudent[];
    invoicesCreated: number;
    invoiceWriteFailed: boolean;
    created: CreatedInvoice[];
    log: unknown[];
    tStart: number;
    tGuards: number;
    tTally: number;
  }
): Promise<GenerateResult> {
  const {
    tenantId,
    billingMonth,
    mode,
    force,
    classesComplete,
    classesIncomplete,
    deferredParents,
    unclaimedBillable,
    unclaimedStudents,
    invoicesCreated,
    invoiceWriteFailed,
    created,
    log,
    tStart,
    tGuards,
    tTally,
  } = c;

  // ── Seal the billing month once it is genuinely finished ──────────────────
  // Mode-independent: an early MANUAL run that happens to complete the month
  // seals it too, so the daily cron then returns "already_complete" instead of
  // re-walking every class. (Previously only auto sealed, so a month finished
  // by hand stayed open and was reprocessed until the cron got to it.)
  //
  // Safe only because completeness is now measured even under force — without
  // that, a forced run would report 0 incomplete classes unconditionally and
  // seal every month regardless of reality, locking out unmarked lessons for
  // good. The four conditions are the whole safety property:
  //   • at least one class actually reckoned with (there WAS work to finish)
  //   • no class left unmarked          (nothing still to bill)
  //   • no parent deferred              (nobody skipped this run)
  //   • no failed invoice write         (nothing to retry)
  //
  // The first condition is what stops a VACUOUS seal. The other three are all
  // trivially true when the run found nothing at all — no classes yet, no
  // students yet, or (the common one) no lesson_sessions in the month, since
  // sessions are created lazily by attendance marking and therefore do not
  // exist for a month nobody has marked. Without this guard, running
  // generation on an empty or not-yet-marked month reported "0 invoices" and
  // then sealed it, locking out every real invoice that month would later
  // have produced. "Nothing happened" is not the same as "everything is
  // finished", and only the latter may close a month.
  //
  // If a month is ever sealed wrongly, delete its billing_periods row — see
  // INVOICE_RUNBOOK.md.
  // A FIFTH condition joins the four above: no billable lesson may be left
  // with nobody to bill. Without it a trial walk-in or an un-registered
  // family's lessons are dropped from the invoice AND the month closes over
  // them, so they can never be billed even after the parent registers — the
  // §7.8/§7.13/§7.32 permanent-underbill shape through a fourth door.
  //
  // The escape hatch is a SETTLEMENT, not an override: the admin records that
  // the money arrived outside SwimSync, or writes it off. Same philosophy as
  // the attendance gate — add a way to RECORD the thing, never a way to skip it.
  const monthFinished =
    classesComplete > 0 &&
    classesIncomplete === 0 &&
    deferredParents.size === 0 &&
    unclaimedBillable === 0 &&
    !invoiceWriteFailed;

  if (monthFinished) {
    // Sealed for THIS TENANT only. The key is (tenant_id, billing_month): a
    // single billing_month key would have let one business finishing July close
    // it for every other tenant, who would then silently bill nothing.
    //
    // DO NOTHING on conflict, not a plain insert: a forced run bypasses the
    // sealed-month guard, so a second one would otherwise hit a duplicate key.
    // The first seal is the true one — its invoices_issued reflects the run
    // that actually did the work.
    await repo.sealBillingMonth(supabase, tenantId, billingMonth, invoicesCreated);
  }

  return {
    tenant_id: tenantId,
    billing_month: billingMonth,
    mode,
    forced: force,
    invoices_created: invoicesCreated,
    classes_still_incomplete: classesIncomplete,
    // Every parent blocked by an incomplete class — NOT just those reaching
    // phase 2. A parent whose only class is unmarked is never tallied at all,
    // so counting inside the phase-2 loop reported 0 while the whole month was
    // blocked, which is exactly the silent case this number exists to surface.
    parents_deferred: deferredParents.size,
    unclaimed_billable: unclaimedBillable,
    ...(unclaimedStudents.length ? { unclaimed_students: unclaimedStudents } : {}),
    sealed: monthFinished,
    status: monthFinished
      ? "complete — billing month sealed"
      : // Everything else is done; the only thing holding the month open is
      // attendance nobody can be invoiced for. Named distinctly so the admin
      // is told to invite a parent or record a settlement, rather than being
      // sent hunting for an unmarked lesson that does not exist.
      classesIncomplete === 0 && deferredParents.size === 0 && unclaimedBillable > 0
      ? `open — ${unclaimedBillable} billable lesson(s) have no parent account to bill`
      : // Nothing to reckon with at all. Called out as its own status because
      // it is NOT "attendance still incomplete" (there is no attendance to be
      // incomplete) and NOT a finished month — it usually means no lesson has
      // been marked for this month yet, or there are no classes/students.
      classesComplete === 0 && classesIncomplete === 0
      ? "nothing_to_bill"
      : mode === "manual"
      ? "manual run complete — month left open, attendance still incomplete"
      : deferredParents.size > 0
      ? `partial — ${deferredParents.size} parent(s) deferred, will retry tomorrow`
      : "partial — will retry tomorrow",
    ...(classesComplete === 0 && classesIncomplete === 0
      ? {
          message:
            `No lessons are recorded for ${billingMonth}, so there is nothing to invoice. ` +
            `The month has been left OPEN — generate again once attendance is marked.`,
        }
      : {}),
    results: log,
    created,
    timings_ms: timingsSince(tStart, tGuards, tTally, performance.now()),
  };
}
