// Students feature constants. Extracted verbatim from page.tsx (Stage 1 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md); no value changed.

/** PostgREST caps every fetch at max_rows (1000). Fetching this many means the
 *  query was (probably) truncated, so search is the way to reach past it —
 *  ⚠ RISK 3 / WAVE_C_SPOOL_PLAN.md Piece 1. */
export const ROW_LIMIT = 1000;

/** Monday-first. Orders a child's chips the way their week runs. */
export const WEEKDAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const STATUS_FILTERS = ["All", "Assigned", "Unassigned", "Inactive"];
