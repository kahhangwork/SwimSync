// Students feature constants. Extracted verbatim from page.tsx (Stage 1 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md); no value changed.

/** PostgREST caps every fetch at max_rows (1000). Fetching this many means the
 *  query was (probably) truncated, so search is the way to reach past it —
 *  ⚠ RISK 3 / WAVE_C_SPOOL_PLAN.md Piece 1. */
export const ROW_LIMIT = 1000;

/** The status pills, in the order the user asked for (2026-10-16). "Active" is
 *  the default and covers Assigned + Unassigned; the other three are badge
 *  labels. Running low and No parent account are toggles, not pills. */
export const STATUS_FILTERS = ["All", "Active", "Inactive", "Assigned", "Unassigned"];

/** The page always OPENS on this — a plain useState default, so leaving the
 *  page and coming back resets it. Never persist it (user, 2026-10-16). */
export const DEFAULT_STATUS_FILTER = "Active";
