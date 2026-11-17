// The incomplete-attendance RESULT, moved verbatim out of generateForTenant
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B7). Only the result is built here — the DECISION
// to stop (`if (blocking.length)`) stays in generateForTenant, before phase 2, where
// it has always been: no invoice, no credit drawn, no email, nothing to unwind.

import type { BlockingLesson, GenerateResult, UnclaimedStudent } from "../types.ts";
import { timingsSince } from "./timings.ts";

export function incompleteAttendanceStop(c: {
  tenantId: string;
  billingMonth: string;
  mode: "auto" | "manual";
  force: boolean;
  blocking: BlockingLesson[];
  classesIncomplete: number;
  deferredParents: ReadonlySet<string>;
  unclaimedBillable: number;
  unclaimedStudents: UnclaimedStudent[];
  log: unknown[];
  tStart: number;
  tGuards: number;
}): GenerateResult {
  const {
    tenantId,
    billingMonth,
    mode,
    force,
    blocking,
    classesIncomplete,
    deferredParents,
    unclaimedBillable,
    unclaimedStudents,
    log,
    tStart,
    tGuards,
  } = c;
  blocking.sort(
    (a, b) =>
      a.session_date.localeCompare(b.session_date) ||
      a.class_title.localeCompare(b.class_title)
  );
  return {
    tenant_id: tenantId,
    billing_month: billingMonth,
    mode,
    forced: force,
    status: "incomplete_attendance",
    invoices_created: 0,
    classes_still_incomplete: classesIncomplete,
    parents_deferred: deferredParents.size,
    // Reported even on the blocked path: an admin fixing unmarked lessons
    // should learn about the unclaimed ones in the same trip, not discover
    // them on the next run.
    unclaimed_billable: unclaimedBillable,
    ...(unclaimedStudents.length ? { unclaimed_students: unclaimedStudents } : {}),
    sealed: false,
    blocking,
    message:
      `Cannot generate invoices for ${billingMonth}: ${blocking.length} lesson(s) still have unmarked attendance. Mark them — or mark them cancelled if the lesson did not run — then generate again.`,
    results: log,
    timings_ms: timingsSince(tStart, tGuards, performance.now(), null),
  };
}
