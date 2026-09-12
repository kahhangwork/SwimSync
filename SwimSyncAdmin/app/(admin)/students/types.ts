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
  /** The FIRST class's title and coach, kept only as sort keys so the Class and
   *  Coach columns still sort (§8.19). Never rendered — the cells render
   *  `classes`. A child in two classes sorts by their earliest in the week,
   *  which is the only ordering that is stable as classes are added. */
  class_title: string | null;
  coach_name: string | null;
  /** Attendance rows. Decides which of a duplicate pair must survive a merge. */
  lessons: number;
};

export type EnrolledClass = {
  id: string;
  title: string;
  coach_name: string | null;
  day: string | null;
  /** Pre-formatted "5:00pm" — the chip has no room for a range. */
  start: string | null;
};
