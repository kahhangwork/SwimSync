// The closed set of entity types the backend writes. A stable enum, not user
// data — safe to hardcode for the filter dropdown.
export const ENTITY_TYPES = [
  "Student",
  "Class",
  "Profile",
  "Tenant",
  "ParentTenant",
  "lesson_session",
  "Coach",
];

export const ROW_LIMIT = 1000;

/**
 * The two whole-day bounds the audit filter sends to PostgREST.
 *
 * ⚠ The +08:00 offset is SPELLED, not implied (§7.227, BATCH_E_PLAN.md RISK 6).
 * A zoneless `${date}T00:00:00` puts the day boundary at the VIEWER's midnight,
 * and this page exists to settle disputes. They live in constants.ts, not
 * domain/, because dao/ may import the feature root but never domain/.
 */
export const sgDayStart = (date: string) => `${date}T00:00:00+08:00`;
export const sgDayEnd = (date: string) => `${date}T23:59:59+08:00`;
