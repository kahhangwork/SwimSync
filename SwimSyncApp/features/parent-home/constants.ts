// The parent Home tab's module-level constants (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F) — moved verbatim from app/(parent)/home/index.tsx.

/** Monday-first, matching how the coach's week reads. Used only to order a
 *  child's classes on screen — an unknown day sorts last via indexOf's -1
 *  becoming the largest value only if handled, so the comparator below treats
 *  it as -1 and puts it first, which is fine: a null day means a class row that
 *  failed to embed, and burying it would hide the failure. */
export const WEEKDAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
