export type ClassRow = {
  id: string;
  title: string;
  coach_id: string;
  coach_name: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  /** The location's name, read from the joined `locations` entity (not the
   *  soon-to-be-dropped free-text column). */
  location_name: string;
  /** FK into `locations`. Every class has one (backfilled + kept NOT NULL). */
  location_id: string;
  price_per_lesson: number;
  category_id: string | null;
  /** Max students for THIS class; NULL = the category default (below), NULL
   *  there too = unlimited. Informational — nothing refuses on it (20260819000100). */
  capacity: number | null;
  category_default_capacity: number | null;
  /** A palette KEY from lib/classColours.ts, never a hex value; NULL = neutral. */
  colour: string | null;
  student_count: number;
  /** ⚠ THE CLASS's OWN FLAG — NOT the enrolment's. `is_active` exists on
   *  `students`, on `student_class_enrolments` AND on `classes`, and this page
   *  embeds `student_class_enrolments(id, is_active)`. Reading the flag off the
   *  wrong nesting level typechecks clean and renders every class retired
   *  (§7.28). Mapped from the TOP-LEVEL row in loadClasses(). */
  is_active: boolean;
  /** When it was retired — NULL while active, and also NULL for a class made
   *  inactive before deactivate_class() existed. Shown so "retired" has a date
   *  attached rather than being a bare state. */
  deactivated_at: string | null;
};

/** A pickable/filterable location. `archived_at` is carried so the form can
 *  show a reactivated class's archived location, labelled, without offering it
 *  as a NEW choice (RISK 6). */
export type LocationOpt = { id: string; name: string; address: string | null; archived_at: string | null };

export type Coach = {
  id: string;
  full_name: string;
  /** The EARLIEST date a shadow rate is in force from, or null for none.
   *
   *  ⚠ A DATE, NOT A BOOLEAN. Payroll refuses when no shadow rate is in force
   *  ON THE LESSON'S DATE (`effective_from <= session_date`), so "they have one
   *  somewhere" is the wrong question: a rate dated next month, or an
   *  assignment backdated before the rate, silences the warning here and still
   *  blocks the whole business's payroll later. */
  shadowRateFrom: string | null;
};

/** A `class_shadow_coaches` row for the class in the drawer. */
export type ShadowAssignment = {
  id: string;
  coach_id: string;
  coach_name: string;
  effective_from: string;
  effective_to: string | null;
};
