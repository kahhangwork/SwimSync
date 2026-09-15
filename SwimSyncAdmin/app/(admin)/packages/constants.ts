// Module-level constants for the Packages page, extracted verbatim at Stage 1
// of the full-track refactor (docs/refactor/PACKAGES_REFACTOR_PLAN.md).

// The Singapore calendar date of a timestamptz, in the dd/mm/yyyy shape this
// page has always shown. `formatSgStamp` pins Asia/Singapore; the bare
// `toLocaleDateString("en-SG")` it replaced rendered the VIEWER's date, a day
// early west of Singapore for anything stamped before 08:00 SGT.
export const DMY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

/** PostgREST caps every fetch at max_rows (1000). Purchases never approach it,
 *  so the "Who holds one" search stays client-side (correct over a bounded
 *  list) — the cap is made explicit + surfaced so a truncated fetch is never a
 *  silent slice (⚠ RISK 3). */
export const ROW_LIMIT = 1000;

/** Singapore dollars, two decimals. The page's one price formatter, shared by
 *  every tier (promoted from the page component at Stage 5). */
export const money = (n: number) => `S$${Number(n).toFixed(2)}`;
