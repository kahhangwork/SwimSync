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
  },
  {
    class_id: "c1",
    student_id: "s2",
    is_active: true,
    enrolled_at: "2026-06-01T02:00:00Z",
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
