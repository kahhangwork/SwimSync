// Pure helpers for the owner-only accounting page. Kept out of the component so
// the money/label rules can be unit-tested (accounting.test.ts).

/**
 * The three states the RPC reports for a month's coach wages:
 *   - 'final'       every rated coach's payout for the month is paid;
 *   - 'draft'       every rated coach has a payout but at least one is a draft
 *                   (still rebuildable — the number can move);
 *   - 'run_payouts' a rated coach has NO payout row for the month, so wages are
 *                   WITHHELD (the RPC returns NULL, never a partial sum).
 */
export type WagesState = "final" | "draft" | "run_payouts";

/**
 * `S$1,234.50`, or `—` when the figure is withheld (null). A negative figure —
 * Net can go negative when wages exceed revenue — keeps the sign OUTSIDE the
 * currency marker: `-S$1,234.50`, not `S$-1,234.50`.
 */
export function moneyOrDash(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}S$${Math.abs(v).toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * `'2026-07'` → `'July 2026'`. Returns the input unchanged if it is not a valid
 * YYYY-MM (the month part is bounded to 01–12 so a bad month is passed through,
 * not silently rolled over into the next year).
 */
export function formatMonth(m: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return m;
  const [y, mo] = m.split("-").map(Number);
  const month = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-SG", {
    month: "long",
    timeZone: "UTC",
  });
  return `${month} ${y}`;
}
