// Students feature types. Extracted verbatim from page.tsx (Stage 1 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md); no shape changed.
//
// Plan §4: this file is meant to hold DOMAIN entities only. `StudentRow` is
// still the row shape the page's own query builds, rendered directly — the
// row → entity mapping lands with the dao tier (Stage 2), which is where the
// column names stop being the UI's business. Until then it lives here so the
// folder convention is settled on zero-risk lines.

/** Which column the scoped search box targets — one field at a time, so the
 *  term is a bound `.ilike` parameter reaching the whole table in the DB rather
 *  than a client filter over the first 1000 rows. */
export type SearchField = "student" | "parent";

export type StudentRow = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  /** null = never recorded (every admin-added child before 20261016000100). */
  gender: string | null;
  level_id: string | null;
  level_label: string | null;
  assignment_status: string;
  is_active: boolean;
  inactivated_at: string | null;
  parent_id: string | null;
  parent_name: string;
  /** EVERY active enrolment. Since Wave 2 (`20260811000100`) a child may hold
   *  several, and this page is the one surface that owns the many-to-many:
   *  adding a class, and removing ONE of them. */
  classes: EnrolledClass[];
  /** Sort keys only, from the FIRST class (§8.19) — never rendered; the cells
   *  render `classes`. A child in two classes sorts by their earliest in the
   *  week. `class_sort_key` is weekday → start time → name (`classSortKey`), the
   *  page's default order; null (no class) sorts last. `coach_name` follows
   *  the same first class, which since 2026-10-16 is earliest by REAL time. */
  class_sort_key: string | null;
  coach_name: string | null;
  /** Attendance rows. Decides which of a duplicate pair must survive a merge. */
  lessons: number;
};

export type EnrolledClass = {
  id: string;
  title: string;
  coach_name: string | null;
  day: string | null;
  /** Pre-formatted "5:00pm" — the chip has no room for a range. DISPLAY ONLY:
   *  as text "10:15 AM" sorts before "9:30 AM". Order by `start_time`. */
  start: string | null;
  /** Raw `HH:MM:SS` from Postgres — fixed width, so it compares correctly. */
  start_time: string | null;
};
