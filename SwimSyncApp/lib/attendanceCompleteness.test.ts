// jest-expo provides describe/it/expect globally (see lessonDates.test.ts).
import {
  isLessonFullyMarked,
  countMarked,
  unmarkedStudents,
  unmarkedDates,
  studentsEnrolledOn,
  expectedStudentsOn,
  type EnrolmentSpan,
} from "./attendanceCompleteness";

/** Open-ended enrolment from `from`. */
const open = (studentId: string, from: string): EnrolmentSpan => ({
  studentId,
  from,
  until: null,
});

describe("isLessonFullyMarked", () => {
  it("is true only when every expected student has a row", () => {
    expect(isLessonFullyMarked(["a", "b"], new Set(["a", "b"]))).toBe(true);
    expect(isLessonFullyMarked(["a", "b"], new Set(["a"]))).toBe(false);
  });

  // The regression this whole module exists for: no session row is what a
  // forgotten lesson looks like, so it must read as UNMARKED, not as "fine".
  it("treats a missing session as unmarked", () => {
    expect(isLessonFullyMarked(["a"], undefined)).toBe(false);
  });

  it("is vacuously true when nobody is expected", () => {
    expect(isLessonFullyMarked([], undefined)).toBe(true);
    expect(isLessonFullyMarked([], new Set())).toBe(true);
  });

  it("ignores rows belonging to students who were not expected", () => {
    expect(isLessonFullyMarked(["a"], new Set(["x"]))).toBe(false);
  });
});

describe("countMarked", () => {
  it("counts only students who were expected", () => {
    expect(countMarked(["a", "b"], new Set(["a", "x"]))).toBe(1);
    expect(countMarked(["a"], undefined)).toBe(0);
  });
});

describe("unmarkedStudents", () => {
  it("returns everyone when there is no session", () => {
    expect(unmarkedStudents(["a", "b"], undefined)).toEqual(["a", "b"]);
  });

  it("returns only those missing a row", () => {
    expect(unmarkedStudents(["a", "b"], new Set(["a"]))).toEqual(["b"]);
  });
});

describe("studentsEnrolledOn", () => {
  it("excludes a student who had not joined yet", () => {
    // The Aisha case: enrolled in June, asked about a lesson in March.
    const spans = [open("aisha", "2026-06-20")];
    expect(studentsEnrolledOn("2026-03-14", spans)).toEqual([]);
    expect(studentsEnrolledOn("2026-06-27", spans)).toEqual(["aisha"]);
  });

  it("includes a student on the day they joined and the day they left", () => {
    // Both ends INCLUSIVE. Load-bearing for the trial walk-in below.
    const spans = [{ studentId: "a", from: "2026-05-02", until: "2026-05-16" }];
    expect(studentsEnrolledOn("2026-05-02", spans)).toEqual(["a"]);
    expect(studentsEnrolledOn("2026-05-16", spans)).toEqual(["a"]);
    expect(studentsEnrolledOn("2026-05-01", spans)).toEqual([]);
    expect(studentsEnrolledOn("2026-05-17", spans)).toEqual([]);
  });

  it("includes a trial walk-in on their single day", () => {
    // add_unclaimed_student opens AND closes the enrolment on one date. An
    // exclusive end would expect them at no lesson at all, and the coach could
    // not review the entry they had just made.
    const spans = [
      { studentId: "walkin", from: "2026-05-09", until: "2026-05-09" },
    ];
    expect(studentsEnrolledOn("2026-05-09", spans)).toEqual(["walkin"]);
    expect(studentsEnrolledOn("2026-05-10", spans)).toEqual([]);
  });

  it("dedupes a student who unenrolled and re-enrolled", () => {
    // Re-enrolling keeps history (PRD §11.5), so two rows can both match.
    const spans = [
      { studentId: "a", from: "2026-01-01", until: "2026-03-01" },
      { studentId: "a", from: "2026-03-01", until: null },
    ];
    expect(studentsEnrolledOn("2026-03-01", spans)).toEqual(["a"]);
  });
});

describe("expectedStudentsOn", () => {
  it("is the students enrolled on that date", () => {
    const spans = [open("a", "2026-01-01"), open("b", "2026-01-20")];
    expect(expectedStudentsOn("2026-01-10", spans, new Map())).toEqual(["a"]);
    expect(expectedStudentsOn("2026-01-24", spans, new Map())).toEqual([
      "a",
      "b",
    ]);
  });

  it("adds a trial booked on that date, and only that date", () => {
    const spans = [open("a", "2026-01-01")];
    const booked = new Map([["2026-01-10", ["guest"]]]);
    expect(expectedStudentsOn("2026-01-10", spans, booked)).toEqual([
      "a",
      "guest",
    ]);
    expect(expectedStudentsOn("2026-01-17", spans, booked)).toEqual(["a"]);
  });

  it("dedupes a booked child who has since enrolled", () => {
    const spans = [open("guest", "2026-01-01")];
    const booked = new Map([["2026-01-10", ["guest"]]]);
    expect(expectedStudentsOn("2026-01-10", spans, booked)).toEqual(["guest"]);
  });
});

describe("unmarkedDates", () => {
  it("reports a date with no session at all", () => {
    const marked = new Map([["2026-01-03", new Set(["a"])]]);
    const spans = [open("a", "2025-12-01")];
    expect(unmarkedDates(["2026-01-03", "2026-01-10"], marked, spans)).toEqual([
      "2026-01-10",
    ]);
  });

  it("reports a partially marked date", () => {
    const marked = new Map([["2026-01-03", new Set(["a"])]]);
    const spans = [open("a", "2025-12-01"), open("b", "2025-12-01")];
    expect(unmarkedDates(["2026-01-03"], marked, spans)).toEqual(["2026-01-03"]);
  });

  // THE BILLING BLOCKER. Before enrolments were spans, 'b' was expected at
  // every lesson in the window including the one before they joined, so this
  // returned ["2026-01-03"] — and an unmarked lesson blocks invoice generation
  // outright, with no override (§8a).
  it("does NOT report a lesson from before a student joined", () => {
    const marked = new Map([
      ["2026-01-03", new Set(["a"])],
      ["2026-01-24", new Set(["a", "b"])],
    ]);
    const spans = [open("a", "2025-12-01"), open("b", "2026-01-20")];
    expect(unmarkedDates(["2026-01-03", "2026-01-24"], marked, spans)).toEqual(
      []
    );
  });

  it("returns nothing when nobody was ever enrolled", () => {
    expect(unmarkedDates(["2026-01-03"], new Map(), [])).toEqual([]);
  });

  it("returns ascending dates", () => {
    const spans = [open("a", "2025-12-01")];
    const out = unmarkedDates(["2026-01-24", "2026-01-03"], new Map(), spans);
    expect(out).toEqual(["2026-01-03", "2026-01-24"]);
  });
});

// ── DO NOT "FIX" THIS. IT IS LOAD-BEARING FOR INVOICING. ────────────────────
// A lesson nobody was expected at is FULLY MARKED. That reads wrong and is
// right: there is nothing to collect, so it must not block a month from being
// invoiced. unmarkedDates() relies on it to skip dates before a class had
// anyone in it, and the billing engine relies on it to seal a month (§8a).
//
// It is also exactly the behaviour that tempts a change, because a coach's card
// showing a green "Marked" on an empty class is a lie. That belongs to the
// DISPLAY layer and is solved there — lib/attendanceSummary.ts returns a
// distinct `no-students` state, and this file is deliberately untouched.
//
// Changing the assertion below changes which months can be invoiced, for every
// tenant. If you are here because it failed, the fix is almost certainly in
// attendanceSummary.ts instead.
describe("an empty expected set is vacuously marked — invoicing depends on this", () => {
  it("is marked when there is no session at all", () => {
    expect(isLessonFullyMarked([], undefined)).toBe(true);
  });

  it("is marked when a session exists with no rows", () => {
    expect(isLessonFullyMarked([], new Set())).toBe(true);
  });

  it("unmarkedDates skips a date nobody was expected at", () => {
    // A class whose only enrolment starts later must not report its earlier
    // weekday dates as unmarked — that blocked whole months (§8.15).
    const dates = ["2026-07-05", "2026-07-12"];
    expect(
      unmarkedDates(dates, new Map(), [
        { studentId: "late", from: "2026-07-10", until: null },
      ])
    ).toEqual(["2026-07-12"]);
  });
});
