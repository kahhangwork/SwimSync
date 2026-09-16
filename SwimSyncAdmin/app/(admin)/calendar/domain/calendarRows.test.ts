import { describe, expect, it } from "vitest";
import type { CalendarLesson } from "@/lib/calendarLessons";
import { calendarSummary, expandDays, rangeLabel, visibleLessons } from "./calendarRows";

// Characterisation test (playbook §2 stage 4): pins the filter/day/summary/label
// behaviour lifted from the Calendar page so the L-B extraction is a no-op.

const lesson = (over: Partial<CalendarLesson>): CalendarLesson =>
  ({
    key: over.key ?? "k",
    classId: "c",
    date: "2026-09-14",
    location: "Pool A",
    mainCoach: { id: "c1", name: "Ana", isCover: false },
    ...over,
  } as CalendarLesson);

describe("calendar derivations", () => {
  const all = [
    lesson({ key: "a", location: "Pool A", mainCoach: { id: "c1", name: "Ana", isCover: false } }),
    lesson({ key: "b", location: "Pool B", mainCoach: { id: "c2", name: "Bo", isCover: false } }),
  ];

  it("visibleLessons filters by location and coach", () => {
    expect(visibleLessons(all, "", "").map((l) => l.key)).toEqual(["a", "b"]);
    expect(visibleLessons(all, "Pool B", "").map((l) => l.key)).toEqual(["b"]);
    expect(visibleLessons(all, "", "c1").map((l) => l.key)).toEqual(["a"]);
  });

  it("expandDays is inclusive of both ends", () => {
    expect(expandDays({ from: "2026-09-14", to: "2026-09-16" })).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
    ]);
  });

  it("calendarSummary shows 'of M' only when filtered", () => {
    expect(calendarSummary(true, 0, 0)).toBe("Loading…");
    expect(calendarSummary(false, 2, 2)).toBe("2 lessons");
    expect(calendarSummary(false, 1, 2)).toBe("1 lesson of 2");
  });

  it("rangeLabel picks a format per view", () => {
    expect(rangeLabel("month", "2026-09-14")).toBe("September 2026");
    expect(rangeLabel("day", "2026-09-14")).toMatch(/Sep/);
    expect(rangeLabel("week", "2026-09-14")).toContain("–");
  });
});
