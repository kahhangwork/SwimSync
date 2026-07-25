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
  /** On this roster only because they have an attendance row or a trial
   *  booking — not because they are enrolled. Lets the UI say so rather than
   *  implying they attend every week. */
  attendedOnly?: boolean;
  /** Booked for a TRIAL on this date specifically. Shown as such, because the
   *  coach is meeting them for the first time and the status they choose
   *  decides what the family is charged. */
  isTrial?: boolean;
};

/**
 * Merge the actively-enrolled students with anyone already marked on this
 * session. Enrolled students keep their order and win on conflict; extras are
 * appended in name order so the list is stable between loads.
 */
export function mergeRoster(
  activeStudents: readonly RosterStudent[],
  attendedStudents: readonly RosterStudent[],
  bookedStudents: readonly RosterStudent[] = []
): RosterStudent[] {
  const enrolledIds = new Set(activeStudents.map((s) => s.id));
  const bookedIds = new Set(bookedStudents.map((s) => s.id));

  const extras = [...bookedStudents, ...attendedStudents]
    .filter((s) => !enrolledIds.has(s.id))
    // The same student can appear once per attendance row in a naive join, and
    // again from the booking list — a booked child who has since been marked.
    .filter((s, i, all) => all.findIndex((o) => o.id === s.id) === i)
    .map((s) => ({ ...s, attendedOnly: true, isTrial: bookedIds.has(s.id) }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return [
    ...activeStudents.map((s) => ({ ...s, attendedOnly: false, isTrial: false })),
    ...extras,
  ];
}
