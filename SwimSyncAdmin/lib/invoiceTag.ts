// The ONE invoice tag and the due-date helpers (docs/plans/OVERDUE_INVOICES_PLAN.md,
// ⚠ RISK 6). Every admin surface that shows an invoice's status renders it through
// invoiceTag() — the precedence (D4) is decided here and nowhere else.
//
// OVERDUE IS DECIDED IN SQL. `is_overdue` is the database's computed field
// (is_overdue(invoices), on app_today()). Nothing here compares a due date to a
// clock: no `new Date()`, no todayInSg(). The key is REQUIRED in the parameter
// type, so a select that forgot `is_overdue` fails typecheck instead of silently
// showing Outstanding. Its sibling is SwimSyncApp/lib/invoiceTag.ts.

import { formatSgDate } from "./lessonDates";

export type InvoiceTag = "Paid" | "Claimed" | "Overdue" | "Outstanding";

/** D4: Paid > Claimed > Overdue > Outstanding. Only `is_overdue === true` is
 *  overdue — a null (an RLS-shaped or missing value) reads as not overdue. */
export function invoiceTag(inv: {
  status: string;
  paid_claimed_at: string | null;
  is_overdue: boolean | null;
}): InvoiceTag {
  if (inv.status !== "outstanding") return "Paid";
  if (inv.paid_claimed_at) return "Claimed";
  if (inv.is_overdue === true) return "Overdue";
  return "Outstanding";
}

/** "2026-11-26" → "26 Nov" (and September → "Sept", en-SG — the same CLDR month
 *  every other screen shows, §7.302). A due date is a calendar DATE, never a
 *  moment, so formatSgDate (UTC-pinned, date-only) — not a clock, not a local
 *  Date. Malformed input comes back unchanged. */
export function dayMonthLabel(ymd: string): string {
  return formatSgDate(ymd, { day: "numeric", month: "short" });
}

/** The calendar day after a "YYYY-MM-DD" — the earliest date Change due date may
 *  pick (the server is the authority; this only sets the input's `min`). UTC
 *  arithmetic on a date-only value, so no local offset can shift it. */
export function nextSgDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
