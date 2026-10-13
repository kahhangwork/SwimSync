import { monthLabel, type BillingMonthRow, type RunBlockingLesson } from "@/lib/billingMonths";

/** The Blocked-Action reason beside Generate (BACKLOG S4, UI restyle 5.1): the
 *  month in the picker is open and its LAST RUN refused on unmarked lessons.
 *  Read from the Billing months rows the page already loaded — no new query —
 *  and it is only ever SHOWN: it never disables Generate (plan 5.1 ⚠ RISK 2;
 *  the engine is the authority, and the stored run is a snapshot that can be
 *  stale the moment a lesson is marked). Null when there is nothing to say. */
export function generateBlockedReason(
  rows: BillingMonthRow[],
  genMonth: string
): { monthLabel: string; blocking: RunBlockingLesson[] } | null {
  const row = rows.find((r) => r.month === genMonth);
  if (!row || row.state !== "open") return null;
  const blocking = row.recentRuns[0]?.blocking ?? [];
  if (blocking.length === 0) return null;
  return { monthLabel: monthLabel(row.month), blocking };
}
