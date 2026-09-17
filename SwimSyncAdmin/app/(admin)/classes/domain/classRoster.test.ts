import { describe, it, expect } from "vitest";
import {
  buildClassRoster,
  formatStudentCount,
  describeStudentCount,
  type RosterEnrolment,
  type RosterBooking,
} from "./classRoster";

const CLASS = "c1";
const OTHER_CLASS = "c2";

function enrolment(
  over: Partial<RosterEnrolment> & { student_id: string }
): RosterEnrolment {
  return {
    class_id: CLASS,
    is_active: true,
    enrolled_at: "2026-05-01T00:00:00Z",
    full_name: over.student_id.toUpperCase(),
    level_label: null,
    ...over,
  };
}

function booking(
  over: Partial<RosterBooking> & { student_id: string; session_date: string }
): RosterBooking {
  return {
    class_id: CLASS,
    full_name: over.student_id.toUpperCase(),
    level_label: null,
    cancelled_at: null,
    ...over,
  };
}

describe("buildClassRoster — enrolled", () => {
  it("keeps only ACTIVE enrolments", () => {
    const rows = [
      enrolment({ student_id: "a" }),
      enrolment({ student_id: "b", is_active: false }),
    ];
    const { enrolled } = buildClassRoster(rows, [], CLASS, "2026-07-26");
    expect(enrolled.map((e) => e.student_id)).toEqual(["a"]);
  });

  it("keeps only enrolments in THIS class", () => {
    const rows = [
      enrolment({ student_id: "a" }),
      enrolment({ student_id: "b", class_id: OTHER_CLASS }),
    ];
    const { enrolled } = buildClassRoster(rows, [], CLASS, "2026-07-26");
    expect(enrolled.map((e) => e.student_id)).toEqual(["a"]);
  });

  it("sorts by name and carries level + joined date through", () => {
    const rows = [
      enrolment({
        student_id: "z",
        full_name: "Zoe",
        level_label: "Turtle 2",
        enrolled_at: "2026-06-02T00:00:00Z",
      }),
      enrolment({ student_id: "a", full_name: "Amir" }),
    ];
    const { enrolled } = buildClassRoster(rows, [], CLASS, "2026-07-26");
    expect(enrolled.map((e) => e.full_name)).toEqual(["Amir", "Zoe"]);
    expect(enrolled[1].level_label).toBe("Turtle 2");
    expect(enrolled[1].enrolled_at).toBe("2026-06-02T00:00:00Z");
  });
});

describe("buildClassRoster — the upcoming-trial boundary", () => {
  // ⚠ The two boundary cases below move `today` against the SAME booking,
  // rather than moving the booking against a fixed today. That is what proves
  // the comparison is against the date passed IN — a module that secretly read
  // a clock would pass a test that moved the booking, and fail these.
  const SAME_BOOKING = [booking({ student_id: "d", session_date: "2026-07-26" })];

  it("counts a trial dated EXACTLY today — the lesson has not happened yet", () => {
    const { trials } = buildClassRoster([], SAME_BOOKING, CLASS, "2026-07-26");
    expect(trials.map((t) => t.student_id)).toEqual(["d"]);
  });

  it("drops the same booking once today has moved past it", () => {
    const { trials } = buildClassRoster([], SAME_BOOKING, CLASS, "2026-07-27");
    expect(trials).toEqual([]);
  });

  it("counts a trial well in the future", () => {
    const rows = [booking({ student_id: "d", session_date: "2026-08-25" })];
    const { trials } = buildClassRoster([], rows, CLASS, "2026-07-26");
    expect(trials.map((t) => t.student_id)).toEqual(["d"]);
  });

  it("drops a CANCELLED booking even when it is dated in the future", () => {
    const rows = [
      booking({
        student_id: "f",
        session_date: "2026-08-02",
        cancelled_at: "2026-07-20T00:00:00Z",
      }),
    ];
    const { trials } = buildClassRoster([], rows, CLASS, "2026-07-26");
    expect(trials).toEqual([]);
  });

  it("keeps only bookings for THIS class", () => {
    const rows = [
      booking({ student_id: "d", session_date: "2026-08-02" }),
      booking({
        student_id: "x",
        session_date: "2026-08-02",
        class_id: OTHER_CLASS,
      }),
    ];
    const { trials } = buildClassRoster([], rows, CLASS, "2026-07-26");
    expect(trials.map((t) => t.student_id)).toEqual(["d"]);
  });

  it("orders trials by date, then by name", () => {
    const rows = [
      booking({ student_id: "late", session_date: "2026-08-09" }),
      booking({ student_id: "zoe", session_date: "2026-08-02", full_name: "Zoe" }),
      booking({ student_id: "amir", session_date: "2026-08-02", full_name: "Amir" }),
    ];
    const { trials } = buildClassRoster([], rows, CLASS, "2026-07-26");
    expect(trials.map((t) => t.student_id)).toEqual(["amir", "zoe", "late"]);
  });
});

describe("formatStudentCount", () => {
  it("renders a bare number when nobody is trialling", () => {
    expect(formatStudentCount(2, 0)).toBe("2");
  });

  it("renders 2+1 — never 3 — when a trial is booked", () => {
    expect(formatStudentCount(2, 1)).toBe("2+1");
    expect(formatStudentCount(2, 1)).not.toBe("3");
  });

  it("renders 0+1 for a class whose only attendee is a trial", () => {
    expect(formatStudentCount(0, 1)).toBe("0+1");
  });

  it("renders 0 for an empty class", () => {
    expect(formatStudentCount(0, 0)).toBe("0");
  });
});

describe("describeStudentCount", () => {
  it("spells the split out in words, singular and plural", () => {
    expect(describeStudentCount(2, 0)).toBe("2 enrolled");
    expect(describeStudentCount(2, 1)).toBe("2 enrolled + 1 trial booked");
    expect(describeStudentCount(2, 3)).toBe("2 enrolled + 3 trials booked");
  });
});
