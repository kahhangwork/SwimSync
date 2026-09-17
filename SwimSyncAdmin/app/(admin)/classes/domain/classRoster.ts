// Who is in a class right now — for the admin Classes page's "See students"
// drawer, and for the count badge beside it.
//
// TWO GROUPS, NEVER MERGED. An enrolled student is expected every week; a
// trial is a guest at ONE lesson. PRD §7.17 is explicit that listing them
// together implies a weekly student — and the admin acting on that belief is
// expensive, because Assign creates an active enrolment, which makes the child
// expected at every lesson, which blocks the class's month from being invoiced
// once one of those lessons goes unmarked. That is why the count renders
// "2+1" rather than "3": the shape of the number carries the distinction.
//
// ⚠ THIS MODULE NEVER READS A CLOCK. `today` is a required parameter of every
// function that needs one, and there is deliberately no import of todayInSg().
// Deriving a date here would reintroduce §7.7: between 00:00 and 08:00 SGT the
// UTC date is the previous day, so a trial booked for today would read as past
// and silently vanish from the count for eight hours out of every twenty-four.
// The same mistake made the lesson_packages suite fail 00:00–08:00 for six
// days. Passing the date in makes that bug unreachable rather than discouraged.
//
// Pure — no Supabase, no React. The caller fetches the two row sets.

/** An enrolment row joined to its student. `is_active` is the whole filter. */
export type RosterEnrolment = {
  class_id: string;
  is_active: boolean;
  /** When this enrolment opened. Displayed as "Joined …". */
  enrolled_at: string;
  student_id: string;
  full_name: string;
  /** The label off tenant_levels, or null when the child has no level set. */
  level_label: string | null;
};

/** A trial booking joined to its student. */
export type RosterBooking = {
  class_id: string;
  /** YYYY-MM-DD, Singapore-local. */
  session_date: string;
  student_id: string;
  full_name: string;
  level_label: string | null;
  /** Set when the booking was cancelled — a cancelled booking expects nobody.
   *  Filtered HERE as well as in the caller's query, deliberately: the rule
   *  then survives anyone reusing this module with a query that forgets it,
   *  and it becomes testable without a database. */
  cancelled_at: string | null;
};

export type EnrolledEntry = {
  student_id: string;
  full_name: string;
  level_label: string | null;
  enrolled_at: string;
};

export type TrialEntry = {
  student_id: string;
  full_name: string;
  level_label: string | null;
  session_date: string;
};

export type ClassRoster = {
  enrolled: EnrolledEntry[];
  trials: TrialEntry[];
};

/**
 * Split one class's rows into the two groups the drawer renders.
 *
 * `today` is YYYY-MM-DD in Singapore terms and is REQUIRED — see the file
 * header. A trial dated exactly `today` still counts: the lesson has not
 * happened yet, and the child is still expected at it.
 */
export function buildClassRoster(
  enrolments: RosterEnrolment[],
  bookings: RosterBooking[],
  classId: string,
  today: string
): ClassRoster {
  const enrolled = enrolments
    .filter((e) => e.class_id === classId && e.is_active)
    .map((e) => ({
      student_id: e.student_id,
      full_name: e.full_name,
      level_label: e.level_label,
      enrolled_at: e.enrolled_at,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  // String comparison is correct and deliberate: YYYY-MM-DD sorts and compares
  // chronologically as text, so no Date is constructed and no timezone is
  // consulted. `>=` is the same boundary the coach roster and Unassigned
  // Children already use — one definition of "upcoming", not a fourth.
  const trials = bookings
    .filter(
      (b) =>
        b.class_id === classId &&
        b.cancelled_at === null &&
        b.session_date >= today
    )
    .map((b) => ({
      student_id: b.student_id,
      full_name: b.full_name,
      level_label: b.level_label,
      session_date: b.session_date,
    }))
    .sort(
      (a, b) =>
        a.session_date.localeCompare(b.session_date) ||
        a.full_name.localeCompare(b.full_name)
    );

  return { enrolled, trials };
}

/**
 * The count badge: "2" with no trials, "2+1" with one.
 *
 * Never "3" — that would assert two different things about a child's
 * relationship to the class are the same thing. Never "2+0" either: a plus
 * sign with nothing after it invites the reader to look for a guest who is not
 * there.
 */
export function formatStudentCount(
  enrolledCount: number,
  trialCount: number
): string {
  return trialCount > 0
    ? `${enrolledCount}+${trialCount}`
    : String(enrolledCount);
}

/** The badge's tooltip — spells out what the "+" means in words. */
export function describeStudentCount(
  enrolledCount: number,
  trialCount: number
): string {
  const enrolledPart = `${enrolledCount} enrolled`;
  if (trialCount === 0) return enrolledPart;
  return `${enrolledPart} + ${trialCount} trial${
    trialCount === 1 ? "" : "s"
  } booked`;
}
