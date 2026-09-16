import { describe, expect, it } from "vitest";
import type { CalendarLesson } from "@/lib/calendarLessons";
import { lessonView } from "./lessonRows";

// Characterisation test (playbook §2 stage 4): pins the filter/group/count
// behaviour lifted verbatim from the Lessons page's useMemo chain, so the L-B
// extraction is provably a no-op.

const lesson = (over: Partial<CalendarLesson>): CalendarLesson => ({
  key: over.key ?? `${over.classId ?? "c"}|${over.date ?? "2026-09-14"}`,
  classId: "c",
  date: "2026-09-14",
  sessionId: null,
  start: "17:00",
  end: "18:00",
  startMin: 1020,
  endMin: 1080,
  title: "Dolphins",
  location: "Pool A",
  colourKey: null,
  capacity: null,
  enrolled: 3,
  guests: 0,
  mainCoach: { id: "coach-1", name: "Ana", isCover: false },
  subName: null,
  shadowNames: [],
  progress: "complete",
  marked: 3,
  offPattern: false,
  holidayName: null,
  cancellationReason: null,
  students: [],
  ...over,
});

const range = { from: "2026-09-14", to: "2026-09-16" };

describe("lessonView", () => {
  const all: CalendarLesson[] = [
    lesson({ key: "a", date: "2026-09-14", location: "Pool A", mainCoach: { id: "c1", name: "Ana", isCover: false }, progress: "complete" }),
    lesson({ key: "b", date: "2026-09-14", location: "Pool B", mainCoach: { id: "c2", name: "Bo", isCover: false }, progress: "unmarked" }),
    lesson({ key: "c", date: "2026-09-16", location: "Pool A", mainCoach: { id: "c1", name: "Ana", isCover: false }, progress: "partial" }),
  ];

  it("week mode keeps everything and groups by date", () => {
    const v = lessonView({ all, range, mode: "week", location: "", coach: "" });
    expect(v.lessons.map((l) => l.key)).toEqual(["a", "b", "c"]);
    expect(v.days).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
    expect(v.byDate.get("2026-09-14")?.map((l) => l.key)).toEqual(["a", "b"]);
    expect(v.byDate.get("2026-09-16")?.map((l) => l.key)).toEqual(["c"]);
  });

  it("needs mode keeps only unmarked/partial; needsCount ignores filters", () => {
    const v = lessonView({ all, range, mode: "needs", location: "", coach: "" });
    expect(v.lessons.map((l) => l.key)).toEqual(["b", "c"]);
    expect(v.needsCount).toBe(2);
  });

  it("location and coach filters narrow the list but not the count", () => {
    const v = lessonView({ all, range, mode: "week", location: "Pool A", coach: "c1" });
    expect(v.lessons.map((l) => l.key)).toEqual(["a", "c"]);
    expect(v.needsCount).toBe(2);
  });
});
