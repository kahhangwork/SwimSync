/** PostgREST caps every fetch at max_rows (1000). Classes never approach it, so
 *  search here stays client-side (correct over a bounded list) — but the cap is
 *  made explicit + surfaced, so a business that somehow exceeds it is TOLD the
 *  list is truncated rather than searching a silent slice (⚠ RISK 3). */
export const ROW_LIMIT = 1000;

export const DAYS = [
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
];
