// Who appears on the Mark Attendance screen for a given date.
//
// THE RULE: everyone actively enrolled, PLUS anyone who already has an
// attendance row on this session.
//
// The second half is not a nicety. A trial walk-in's enrolment is opened AND
// CLOSED on its own date (add_unclaimed_student, 20260725000200) so that a
// one-off attendee can never block the completeness gate on every future
// lesson. But the roster used to be built from `is_active` enrolments alone —
// so the moment that enrolment closed, the child vanished from the very screen
// that had just marked them. The coach could not review or correct their own
// entry, and `coach_serves_student()` (which also requires an active enrolment)
// would not have helped.
//
// Reading it the other way round, this is simply correct: a marking screen for
// a date should show everyone who was marked on that date. The same holds for
// a student removed from the class mid-month — their already-marked lessons
// stay visible and correctable, which is what the credit-note flow assumes.

export type RosterStudent = {
  id: string;
  full_name: string;
  /** On this roster only because they have an attendance row or a booking —
   *  not because they are enrolled. Lets the UI say so rather than implying
   *  they attend every week. */
  attendedOnly?: boolean;
  /** Booked for a TRIAL on this date specifically. Shown as such, because the
   *  coach is meeting them for the first time and the status they choose
   *  decides what the family is charged. */
  isTrial?: boolean;
  /** Booked for a MAKE-UP on this date specifically — an enrolled child from
   *  another same-category class, guesting for one lesson. Ordinary statuses
   *  apply (the trial statuses do not); a present make-up bills at the
   *  child's own class rate, or draws from the family's package. */
  isMakeup?: boolean;
};

/**
 * Merge the actively-enrolled students with anyone already marked on this
 * session. Enrolled students keep their order and win on conflict; extras are
 * appended in name order so the list is stable between loads.
 *
 * ── EVERY ID APPEARS AT MOST ONCE, INCLUDING WITHIN `activeStudents` ────────
 * This used to dedupe only the extras, and a duplicate in `activeStudents` was
 * passed straight through. That is not hypothetical: the caller builds that
 * list from ENROLMENT ROWS, and a child can hold more than one for the same
 * class — unenrol then re-enrol keeps history (PRD §11.5), so two spans can
 * both cover one date.
 *
 * The consequence was a hard failure of the whole save. The screen sends one
 * upsert for the entire class, so two rows with the same
 * (lesson_session_id, student_id) make Postgres refuse the statement outright:
 *
 *   ERROR: ON CONFLICT DO UPDATE command cannot affect row a second time
 *
 * One duplicated child therefore blocked attendance for everybody in the
 * class, reported only as "Failed to save attendance. Please try again." It
 * surfaced when a coach backdated every active enrolment, which made the open
 * span start before an older closed one in the same class ended.
 *
 * `attendanceCompleteness.ts` has always deduped for exactly this reason (see
 * studentsEnrolledOn) — the billing gate was right and the screen was wrong.
 * Keeping the rule here, at the one place that owns "who is on this screen",
 * rather than at the call site, so a second caller cannot reintroduce it.
 */
export function mergeRoster(
  activeStudents: readonly RosterStudent[],
  attendedStudents: readonly RosterStudent[],
  bookedStudents: readonly RosterStudent[] = [],
  makeupStudents: readonly RosterStudent[] = []
): RosterStudent[] {
  const enrolledIds = new Set(activeStudents.map((s) => s.id));
  const bookedIds = new Set(bookedStudents.map((s) => s.id));
  const makeupIds = new Set(makeupStudents.map((s) => s.id));

  // First occurrence wins, so the caller's ordering is preserved.
  const enrolledOnce = activeStudents.filter(
    (s, i, all) => all.findIndex((o) => o.id === s.id) === i
  );

  const extras = [...bookedStudents, ...makeupStudents, ...attendedStudents]
    .filter((s) => !enrolledIds.has(s.id))
    // The same student can appear once per attendance row in a naive join, and
    // again from a booking list — a booked child who has since been marked.
    .filter((s, i, all) => all.findIndex((o) => o.id === s.id) === i)
    .map((s) => ({
      ...s,
      attendedOnly: true,
      isTrial: bookedIds.has(s.id),
      // A trial booking wins the label if both somehow exist — a trial child
      // cannot be enrolled, so a same-day make-up booking is a data error and
      // "Trial" is the safer thing to tell the coach.
      isMakeup: !bookedIds.has(s.id) && makeupIds.has(s.id),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return [
    ...enrolledOnce.map((s) => ({
      ...s,
      attendedOnly: false,
      isTrial: false,
      isMakeup: false,
    })),
    ...extras,
  ];
}
