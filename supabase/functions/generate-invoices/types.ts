// The billing engine's public types, moved verbatim out of core.ts
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B1). core.ts re-exports them.

import type { Database } from "../_shared/database.overrides.ts";

/** Wall-clock milliseconds spent in each part of one tenant's run. */
export type RunTimings = {
  /** Settings, seal, ordering guard, run day. */
  guards: number;
  /** Phase 1: the batched reads, the class loop, settlements, drawn lessons. */
  tally: number;
  /** Phase 2: invoice writes and credit, plus the seal. */
  invoices: number;
  total: number;
};

export type GenerateOptions = {
  mode?: string;
  force?: boolean;
  billing_month?: string;
  /** Restrict the run to ONE tenant. The admin route always sets this (an
   *  admin may only bill their own business); the daily cron omits it and
   *  every tenant is processed independently. */
  tenant_id?: string;
  /** Who pressed Generate (a profiles.id), for the run log only — never used
   *  for authorisation. Set by the admin route, which has already verified the
   *  caller; absent on the cron. See runLog.ts. */
  requested_by?: string;
  /** Clock injection — TESTS ONLY. Production callers omit it and get the real
   *  time. Exists so the run-day guard and the default billing month can be
   *  exercised deterministically rather than only on the right day of the
   *  month. Never sent over the wire (index.ts passes the parsed body through,
   *  and a JSON string here would be ignored by the Date checks below). */
  now?: Date;
};

// One billed lesson on a created invoice — enough for an itemized email.
export type CreatedInvoiceItem = {
  student_id: string;
  session_date: string;
  class_title: string;
  amount: number;
};

// A newly-created invoice, surfaced so the caller (index.ts) can email the
// parent. The engine itself sends nothing — it stays pure and testable; the
// handler orchestrates delivery from this list. Only genuinely-new invoices
// appear here (parents with an existing invoice for the month are skipped),
// so emailing this list can never double-send.
//
// `items` may span MULTIPLE CLASSES — one entry per parent per run, carrying
// every billable lesson across all their children. email.ts already renders
// per-item class titles, so this needs no special handling there.
export type CreatedInvoice = {
  invoice_id: string;
  parent_id: string;
  /** The business that issued it — the email is branded as THEM, not SwimSync. */
  tenant_id: string;
  billing_month: string;
  gross: number;
  /** Prepaid package value applied. net = gross − package − credit + balance_adjustment. */
  package: number;
  credit: number;
  /** A prior-period DEBIT (voided-then-paid credit) folded onto this invoice. */
  balance_adjustment: number;
  net: number;
  /** "YYYY-MM-DD", SGT — the stored invoices.due_date (set by the insert trigger,
   *  20261112000100). Printed as read; no TypeScript ever computes a due date. */
  due_date: string;
  items: CreatedInvoiceItem[];
};

// A lesson standing between the admin and generation: which class, which date,
// and how many enrolled students still have no attendance row on it.
export type BlockingLesson = {
  tenant_id: string;
  class_id: string;
  class_title: string;
  session_date: string;
  unmarked_student_count: number;
};

/** A student with no parent account who has billable, unsettled attendance in
 *  the billing month. The admin resolves them by inviting the parent (so the
 *  lessons bill normally) or by recording a settlement. */
export type UnclaimedStudent = {
  student_id: string;
  student_name: string | null;
  /** Billable lessons in this month that nobody can be invoiced for. */
  lessons: number;
  /** Earliest and latest such lesson, so the admin can date a settlement. */
  earliest_session_date: string;
  latest_session_date: string;
};

export type GenerateResult = {
  billing_month: string;
  status: string;
  /** The tenant this result describes. Absent on a multi-tenant aggregate. */
  tenant_id?: string;
  /** Per-tenant breakdown, present only on a multi-tenant (cron) run. */
  per_tenant?: GenerateResult[];
  mode?: string;
  forced?: boolean;
  invoices_created?: number;
  classes_still_incomplete?: number;
  parents_deferred?: number;
  /** Present when status is "earlier_month_unbilled": the earliest earlier month
   *  ("YYYY-MM") that must be billed before this one can be. */
  earlier_unbilled_month?: string;
  /** True when this run left the month finished and closed — no further run
   *  will process it (they short-circuit on the sealed-month guard). */
  sealed?: boolean;
  /** Present when status is "incomplete_attendance": the lessons to mark
   *  before generation can proceed. Empty/absent otherwise. */
  blocking?: BlockingLesson[];
  /** Billable lessons attended by a student with NO parent account, and not
   *  covered by a settlement. These cannot be invoiced — there is nobody to
   *  bill — so they are REPORTED rather than silently dropped, and they hold
   *  the month OPEN. See the seal block. */
  unclaimed_billable?: number;
  /** Who those lessons belong to, so the admin can act: invite the parent, or
   *  record the money as settled outside SwimSync. */
  unclaimed_students?: UnclaimedStudent[];
  message?: string;
  results?: unknown[];
  created?: CreatedInvoice[];
  /** Per-tenant timing, on every run that ATTEMPTED to bill (absent on the
   *  early-return refusals, which write no run row either — runLog.ts). */
  timings_ms?: RunTimings;
};

// One billable line, as the tally builds it and phase 2 inserts it. Moved verbatim
// out of generateForTenant (B6).
export type InvoiceItem = {
  student_id: string;
  lesson_session_id: string;
  attendance_status: Database["public"]["Enums"]["attendance_status"];
  amount: number;
  class_title: string;
  session_date: string;
  // The name AS INVOICED. Snapshotted for the same reason class_title is:
  // an invoice is a document that gets sent, and it must not rewrite itself
  // when a child is renamed later. Reading it live is the same mistake as
  // reading classes.price_per_lesson at generation time.
  student_name: string | null;
};
