import { describe, it, expect } from "vitest";
import {
  computeClassCoverage,
  type CoverageClass,
  type CoverageEnrolment,
  type CoverageSession,
  type CoverageAttendance,
} from "./classCoverage";

// July 2026's Saturdays: 4th, 11th, 18th, 25th.
const SATURDAY_CLASS: CoverageClass = {
  id: "c1",
  title: "Saturday Beginners",
  day_of_week: "saturday",
};

const TWO_STUDENTS: CoverageEnrolment[] = [
  {
    class_id: "c1",
    student_id: "s1",
    is_active: true,
    enrolled_at: "2026-06-01T02:00:00Z",
        unenrolled_at: null,
  },
  {
    class_id: "c1",
    student_id: "s2",
    is_active: true,
    enrolled_at: "2026-06-01T02:00:00Z",
        unenrolled_at: null,
  },
];

/** Sessions + full attendance for the given July Saturdays. */
function fullyMarked(days: number[]): {
  sessions: CoverageSession[];
  attendance: CoverageAttendance[];
} {
  const sessions = days.map((d) => ({
    id: `sess-${d}`,
    class_id: "c1",
    session_date: `2026-07-${String(d).padStart(2, "0")}`,
  }));
  const attendance = days.flatMap((d) => [
    { lesson_session_id: `sess-${d}`, student_id: "s1" },
    { lesson_session_id: `sess-${d}`, student_id: "s2" },
  ]);
  return { sessions, attendance };
}

const AFTER_JULY = "2026-08-01";

describe("computeClassCoverage", () => {
  it("reports a fully marked month as complete", () => {
    const { sessions, attendance } = fullyMarked([4, 11, 18, 25]);
    const [cov] = computeClassCoverage(
      [SATURDAY_CLASS],
      TWO_STUDENTS,
      sessions,
      attendance,
      "2026-07",
      AFTER_JULY
    );
    expect(cov.expected).toBe(4);
    expect(cov.marked).toBe(4);
    expect(cov.missingDates).toEqual([]);
  });

  it("catches a Saturday that was never marked at all", () => {
    // The whole point: session row absent entirely, not merely incomplete.
    const { sessions, attendance } = fullyMarked([4, 11, 25]);
    const [cov] = computeClassCoverage(
      [SATURDAY_CLASS],
      TWO_STUDENTS,
      sessions,
      attendance,
      "2026-07",
      AFTER_JULY
    );
    expect(cov.expected).toBe(4);
    expect(cov.marked).toBe(3);
    expect(cov.missingDates).toEqual(["2026-07-18"]);
  });

  it("catches a session where only some students were marked", () => {
    const { sessions, attendance } = fullyMarked([4, 11, 18, 25]);
    const partial = attendance.filter(
      (a) => !(a.lesson_session_id === "sess-18" && a.student_id === "s2")
    );
    const [cov] = computeClassCoverage(
      [SATURDAY_CLASS],
      TWO_STUDENTS,
      sessions,
      partial,
      "2026-07",
      AFTER_JULY
    );
    expect(cov.marked).toBe(3);
    expect(cov.missingDates).toEqual(["2026-07-18"]);
  });

  it("does not count future lessons in the current month as missing", () => {
    const { sessions, attendance } = fullyMarked([4, 11]);
    const [cov] = computeClassCoverage(
      [SATURDAY_CLASS],
      TWO_STUDENTS,
      sessions,
      attendance,
      "2026-07",
      "2026-07-15" // mid-month: the 18th and 25th haven't happened yet
    );
    expect(cov.expected).toBe(2);
    expect(cov.marked).toBe(2);
    expect(cov.missingDates).toEqual([]);
  });

  it("does not expect lessons from before the class had any students", () => {
    const lateEnrolment: CoverageEnrolment[] = [
      {
        class_id: "c1",
        student_id: "s1",
        is_active: true,
        enrolled_at: "2026-07-15T02:00:00Z",
        unenrolled_at: null,
      },
    ];
    const sessions = [
      { id: "sess-18", class_id: "c1", session_date: "2026-07-18" },
      { id: "sess-25", class_id: "c1", session_date: "2026-07-25" },
    ];
    const attendance = [
      { lesson_session_id: "sess-18", student_id: "s1" },
      { lesson_session_id: "sess-25", student_id: "s1" },
    ];
    const [cov] = computeClassCoverage(
      [SATURDAY_CLASS],
      lateEnrolment,
      sessions,
      attendance,
      "2026-07",
      AFTER_JULY
    );
    // The 4th and 11th predate the enrolment and must not be reported.
    expect(cov.expected).toBe(2);
    expect(cov.missingDates).toEqual([]);
  });

  it("bounds enrolment dates in Singapore time", () => {
    // 2026-07-03T18:00Z is 2026-07-04T02:00 SGT — the student WAS enrolled on
    // the 4th, so that Saturday is expected. Reading the UTC date would say the
    // 3rd, which happens to give the same answer here; the case that matters is
    // that the SG date never lands before the enrolment's real local day.
    const enrolment: CoverageEnrolment[] = [
      {
        class_id: "c1",
        student_id: "s1",
        is_active: true,
        enrolled_at: "2026-07-03T18:00:00Z",
        unenrolled_at: null,
      },
    ];
    const [cov] = computeClassCoverage(
      [SATURDAY_CLASS],
      enrolment,
      [],
      [],
      "2026-07",
      AFTER_JULY
    );
    expect(cov.expected).toBe(4);
    expect(cov.missingDates).toEqual([
      "2026-07-04",
      "2026-07-11",
      "2026-07-18",
      "2026-07-25",
    ]);
  });

  it("omits a class with no active students rather than calling it complete", () => {
    // Guards a vacuous truth: 'every active student marked' is trivially true
    // for an empty student set, which would report a green all-clear.
    const unenrolled: CoverageEnrolment[] = [
      {
        class_id: "c1",
        student_id: "s1",
        is_active: false,
        enrolled_at: "2026-06-01T02:00:00Z",
        unenrolled_at: null,
      },
    ];
    expect(
      computeClassCoverage(
        [SATURDAY_CLASS],
        unenrolled,
        [],
        [],
        "2026-07",
        AFTER_JULY
      )
    ).toEqual([]);
  });

  it("keeps classes independent", () => {
    const sundayClass: CoverageClass = {
      id: "c2",
      title: "Sunday Advanced",
      day_of_week: "sunday",
    };
    const enrolments: CoverageEnrolment[] = [
      ...TWO_STUDENTS,
      {
        class_id: "c2",
        student_id: "s3",
        is_active: true,
        enrolled_at: "2026-06-01T02:00:00Z",
        unenrolled_at: null,
      },
    ];
    const { sessions, attendance } = fullyMarked([4, 11, 18, 25]);
    const result = computeClassCoverage(
      [SATURDAY_CLASS, sundayClass],
      enrolments,
      sessions,
      attendance,
      "2026-07",
      AFTER_JULY
    );
    expect(result).toHaveLength(2);
    expect(result[0].missingDates).toEqual([]);
    // July 2026's Sundays — none marked.
    expect(result[1].expected).toBe(4);
    expect(result[1].marked).toBe(0);
  });

  it("returns nothing for a malformed billing month", () => {
    expect(
      computeClassCoverage([SATURDAY_CLASS], TWO_STUDENTS, [], [], "nope", AFTER_JULY)
    ).toEqual([]);
  });
});

// ⚠ RISK N. The engine and this check compute the same rule separately, and
// they diverged once before — the client became the only effective gate and it
// cost a live underbill (§7.18). A booked-but-unmarked trial is the newest way
// they could disagree: the engine expects the child on their lesson and refuses
// to seal, so this dialog must name the same lesson rather than report all clear.
describe("trial bookings", () => {
  const cls = [{ id: "c1", title: "Sat Group", day_of_week: "saturday" as const }];
  const enrolled = [
    { class_id: "c1", student_id: "s1", is_active: true, enrolled_at: "2026-01-01", unenrolled_at: null },
  ];
  const sess1 = { id: "sess1", class_id: "c1", session_date: "2026-08-01" };
  const booking = [
    { class_id: "c1", student_id: "trial1", session_date: "2026-08-01" },
  ];

  it("reports a booked-but-unmarked trial as a missing lesson", () => {
    const out = computeClassCoverage(
      cls, enrolled, [sess1],
      // The enrolled student IS marked; the booked child is not.
      [{ lesson_session_id: "sess1", student_id: "s1" }],
      "2026-08", "2026-08-31", booking
    );
    expect(out[0].missingDates).toContain("2026-08-01");
  });

  it("clears once the trial is marked", () => {
    const out = computeClassCoverage(
      cls, enrolled, [sess1],
      [
        { lesson_session_id: "sess1", student_id: "s1" },
        { lesson_session_id: "sess1", student_id: "trial1" },
      ],
      "2026-08", "2026-08-31", booking
    );
    expect(out[0].missingDates).not.toContain("2026-08-01");
  });

  // A trial is expected at ONE lesson. Expecting them weekly would make every
  // other Saturday of the month report as missing.
  it("does not expect a booked child at the class's other lessons", () => {
    const out = computeClassCoverage(
      cls, enrolled,
      [sess1, { id: "sess2", class_id: "c1", session_date: "2026-08-08" }],
      [
        { lesson_session_id: "sess1", student_id: "s1" },
        { lesson_session_id: "sess1", student_id: "trial1" },
        { lesson_session_id: "sess2", student_id: "s1" },
      ],
      "2026-08", "2026-08-31", booking
    );
    expect(out[0].missingDates).not.toContain("2026-08-08");
  });

  // Passing no bookings at all must behave exactly as before this existed.
  it("is unchanged when a business has no bookings", () => {
    const out = computeClassCoverage(
      cls, enrolled, [sess1],
      [{ lesson_session_id: "sess1", student_id: "s1" }],
      "2026-08", "2026-08-31"
    );
    expect(out[0].missingDates).not.toContain("2026-08-01");
  });

  // MAKE-UP bookings ride the same parameter — the invoices page concatenates
  // trial and make-up rows into one list. This pins that a booked-but-unmarked
  // make-up guest names the same missing lesson the engine's blocking list
  // does (§7.18: the pre-flight and the gate must tell one story).
  it("reports a booked-but-unmarked MAKE-UP guest as a missing lesson", () => {
    const makeup = [
      { class_id: "c1", student_id: "guest1", session_date: "2026-08-01" },
    ];
    const out = computeClassCoverage(
      cls, enrolled, [sess1],
      [{ lesson_session_id: "sess1", student_id: "s1" }],
      "2026-08", "2026-08-31",
      [...booking, ...makeup]
    );
    expect(out[0].missingDates).toContain("2026-08-01");

    const marked = computeClassCoverage(
      cls, enrolled, [sess1],
      [
        { lesson_session_id: "sess1", student_id: "s1" },
        { lesson_session_id: "sess1", student_id: "trial1" },
        { lesson_session_id: "sess1", student_id: "guest1" },
      ],
      "2026-08", "2026-08-31",
      [...booking, ...makeup]
    );
    expect(marked[0].missingDates).not.toContain("2026-08-01");
  });
});
