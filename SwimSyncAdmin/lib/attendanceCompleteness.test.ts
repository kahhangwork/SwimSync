import { describe, it, expect } from "vitest";
import {
  isLessonFullyMarked,
  countMarked,
  unmarkedStudents,
  unmarkedDates,
} from "./attendanceCompleteness";

describe("isLessonFullyMarked", () => {
  it("is true only when every active student has a row", () => {
    expect(isLessonFullyMarked(["a", "b"], new Set(["a", "b"]))).toBe(true);
    expect(isLessonFullyMarked(["a", "b"], new Set(["a"]))).toBe(false);
  });

  // The regression this whole module exists for: no session row is what a
  // forgotten lesson looks like, so it must read as UNMARKED, not as "fine".
  it("treats a missing session as unmarked", () => {
    expect(isLessonFullyMarked(["a"], undefined)).toBe(false);
  });

  it("is vacuously true when nobody is enrolled", () => {
    expect(isLessonFullyMarked([], undefined)).toBe(true);
    expect(isLessonFullyMarked([], new Set())).toBe(true);
  });

  it("ignores rows belonging to departed students", () => {
    // 'x' left the class; their row must not make the lesson look marked.
    expect(isLessonFullyMarked(["a"], new Set(["x"]))).toBe(false);
  });
});

describe("countMarked", () => {
  it("counts only students still enrolled", () => {
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

describe("unmarkedDates", () => {
  it("reports a date with no session at all", () => {
    const marked = new Map([["2026-01-03", new Set(["a"])]]);
    expect(unmarkedDates(["2026-01-03", "2026-01-10"], marked, ["a"])).toEqual([
      "2026-01-10",
    ]);
  });

  it("reports a partially marked date", () => {
    const marked = new Map([["2026-01-03", new Set(["a"])]]);
    expect(unmarkedDates(["2026-01-03"], marked, ["a", "b"])).toEqual([
      "2026-01-03",
    ]);
  });

  it("returns nothing when the class has no active students", () => {
    expect(unmarkedDates(["2026-01-03"], new Map(), [])).toEqual([]);
  });

  it("returns ascending dates", () => {
    const out = unmarkedDates(["2026-01-24", "2026-01-03"], new Map(), ["a"]);
    expect(out).toEqual(["2026-01-03", "2026-01-24"]);
  });
});
