import { describe, it, expect } from "vitest";
import { buildCalendarLessons, type BuildInput, type CalendarClass } from "@/lib/calendarLessons";
import { lessonNav, UNASSIGNED_LABEL, type LessonNav } from "./lessonNav";

// Every case builds its lessons with the REAL buildCalendarLessons from raw rows,
// so the set the strip steps through is pinned to the set the Calendar shows —
// a hand-made CalendarLesson[] would let the two drift apart unnoticed.

const DATE = "2026-08-17"; // a Monday

const cls = (id: string, title: string, start: string, coach: string, over: Partial<CalendarClass> = {}): CalendarClass => ({
  id,
  title,
  day_of_week: "monday",
  start_time: `${start}:00`,
  end_time: "23:00:00",
  location_name: "Pool",
  coach_id: coach,
  colour: null,
  capacity: null,
  category_default_capacity: null,
  is_active: true,
  deactivated_at: null,
  ...over,
});

const href = (classId: string, date = DATE) => `/lessons/${classId}/${date}`;

function lessons(classes: CalendarClass[], over: Partial<BuildInput> = {}) {
  return buildCalendarLessons({
    range: { from: DATE, to: DATE },
    today: "2026-08-19",
    nowMinutes: 12 * 60,
    classes,
    sessions: [],
    enrolments: [],
    bookings: [],
    attendance: [],
    substitutes: [],
    // Each class is paid to its own coach_id — the "regular coach".
    classRates: classes.map((c) => ({ class_id: c.id, effective_from: "2000-01-01", paid_coach_id: c.coach_id })),
    shadows: [],
    absences: [],
    coachNames: new Map([
      ["kah", "Kah Hang"],
      ["amy", "Amy"],
      ["zed", "Zed"],
    ]),
    holidays: [],
    ...over,
  });
}

// Kah Hang's Sunday-style morning: 08:45, 09:30, 10:15. Amy teaches one at 07:00.
const KAH = [cls("k1", "Tanglin 845am", "08:45", "kah"), cls("k2", "Tanglin 930am", "09:30", "kah"), cls("k3", "Tanglin 1015am", "10:15", "kah")];
const AMY = [cls("a1", "Early Bird", "07:00", "amy")];

/** Follow nextHref from the first lesson; returns the classIds in visit order. */
function walkLessons(ls: ReturnType<typeof lessons>, startId: string, mainId: string | null) {
  const seen: string[] = [];
  let id: string | null = startId;
  while (id && seen.length < 50) {
    seen.push(id);
    const nav = lessonNav(ls, id, DATE, mainId);
    id = nav?.lesson.nextHref?.split("/")[2] ?? null;
  }
  return seen;
}

describe("lessonNav — within a coach's day", () => {
  const ls = lessons([...KAH, ...AMY]);

  it("the first lesson has no previous, and next is the following lesson by time", () => {
    const nav = lessonNav(ls, "k1", DATE, "kah")!;
    expect(nav.lesson).toEqual({ position: 1, total: 3, prevHref: null, nextHref: href("k2") });
  });

  it("the last lesson has no next", () => {
    const nav = lessonNav(ls, "k3", DATE, "kah")!;
    expect(nav.lesson).toEqual({ position: 3, total: 3, prevHref: href("k2"), nextHref: null });
  });

  it("orders by start time, not by input order or title", () => {
    const shuffled = lessons([KAH[2], ...AMY, KAH[0], KAH[1]]);
    expect(walkLessons(shuffled, "k1", "kah")).toEqual(["k1", "k2", "k3"]);
  });

  it("ties on time break by title", () => {
    const tie = lessons([cls("x2", "B class", "09:00", "kah"), cls("x1", "A class", "09:00", "kah")]);
    expect(walkLessons(tie, "x1", "kah")).toEqual(["x1", "x2"]);
  });

  it("a tie on time AND title is deterministic in either input order, and the walk visits each lesson once", () => {
    const a = cls("t-aaa", "Nav Tie", "08:00", "kah", { location_name: "Pool A" });
    const b = cls("t-bbb", "Nav Tie", "08:00", "kah", { location_name: "Pool B" });
    const before = cls("t-0", "Nav Early", "07:00", "kah");
    const after = cls("t-z", "Nav Late", "09:00", "kah");
    const one = lessons([before, a, b, after]);
    const two = lessons([after, b, a, before]);
    const expected = ["t-0", "t-aaa", "t-bbb", "t-z"];
    expect(walkLessons(one, "t-0", "kah")).toEqual(expected);
    expect(walkLessons(two, "t-0", "kah")).toEqual(expected);
    // The walk ends on a disabled Next, not a loop.
    expect(lessonNav(two, "t-z", DATE, "kah")!.lesson.nextHref).toBeNull();
  });
});

describe("lessonNav — between coaches", () => {
  it("coaches run A→Z; the coach hrefs land on that coach's EARLIEST lesson", () => {
    const ls = lessons([...KAH, ...AMY, cls("z1", "Zed late", "18:00", "zed"), cls("z0", "Zed early", "06:00", "zed")]);
    const nav = lessonNav(ls, "k2", DATE, "kah")!;
    expect(nav.coach).toEqual({ name: "Kah Hang", position: 2, total: 3, prevHref: href("a1"), nextHref: href("z0") });
    expect(lessonNav(ls, "a1", DATE, "amy")!.coach.prevHref).toBeNull();
    expect(lessonNav(ls, "z1", DATE, "zed")!.coach.nextHref).toBeNull();
  });

  it("walking Next coach visits every coach once, ending disabled", () => {
    const ls = lessons([...KAH, ...AMY, cls("z1", "Zed", "06:00", "zed")]);
    const seen: string[] = [];
    let at: { id: string; coach: string } | null = { id: "a1", coach: "amy" };
    const coachOf = new Map(ls.map((l) => [l.classId, l.mainCoach.id]));
    while (at && seen.length < 10) {
      const nav: LessonNav = lessonNav(ls, at.id, DATE, at.coach)!;
      seen.push(nav.coach.name);
      const next: string | undefined = nav.coach.nextHref?.split("/")[2];
      at = next ? { id: next, coach: coachOf.get(next)! } : null;
    }
    expect(seen).toEqual(["Amy", "Kah Hang", "Zed"]);
  });

  it("lessons with no resolvable coach form an Unassigned group, LAST", () => {
    // No class_rates row for "u1" → attribution resolves no coach.
    const classes = [...AMY, cls("u1", "Orphan", "05:00", "nobody")];
    const ls = lessons(classes, {
      classRates: [{ class_id: "a1", effective_from: "2000-01-01", paid_coach_id: "amy" }],
    });
    const nav = lessonNav(ls, "u1", DATE, null)!;
    expect(nav.coach).toEqual({ name: UNASSIGNED_LABEL, position: 2, total: 2, prevHref: href("a1"), nextHref: null });
  });

  it("a lesson a substitute covers sits in the SUBSTITUTE's sequence, not the regular coach's", () => {
    const ls = lessons([...KAH, ...AMY], {
      sessions: [{ id: "s-k2", class_id: "k2", session_date: DATE, off_schedule_reason: null }],
      substitutes: [{ lesson_session_id: "s-k2", coach_id: "amy" }],
    });
    const covered = lessonNav(ls, "k2", DATE, "amy")!;
    expect(covered.coach.name).toBe("Amy");
    expect(covered.lesson).toEqual({ position: 2, total: 2, prevHref: href("a1"), nextHref: null });
    // Kah Hang's own day skips the covered lesson.
    expect(walkLessons(ls, "k1", "kah")).toEqual(["k1", "k3"]);
  });
});

describe("lessonNav — when the strip hides (null)", () => {
  it("the page's teaching coach disagrees with the Calendar's → null", () => {
    const ls = lessons([...KAH]);
    expect(lessonNav(ls, "k1", DATE, "amy")).toBeNull();
    expect(lessonNav(ls, "k1", DATE, null)).toBeNull();
  });

  it("an off-pattern date with NO session row is not in the list → null", () => {
    const tuesday = "2026-08-18";
    const ls = buildCalendarLessons({
      ...baseInput(KAH),
      range: { from: tuesday, to: tuesday },
    });
    expect(lessonNav(ls, "k1", tuesday, "kah")).toBeNull();
  });

  it("an off-pattern date WITH a session row (an extra lesson) is found", () => {
    const tuesday = "2026-08-18";
    const ls = buildCalendarLessons({
      ...baseInput(KAH),
      range: { from: tuesday, to: tuesday },
      sessions: [{ id: "extra", class_id: "k1", session_date: tuesday, off_schedule_reason: "make-up" }],
    });
    const nav = lessonNav(ls, "k1", tuesday, "kah")!;
    expect(nav.lesson).toEqual({ position: 1, total: 1, prevHref: null, nextHref: null });
  });

  it("a class retired on/before the date, with no session row → null", () => {
    // 2026-08-16T16:00Z = 2026-08-17 00:00 SGT: retired ON the date.
    const ls = lessons([cls("k1", "Tanglin 845am", "08:45", "kah", { is_active: false, deactivated_at: "2026-08-16T16:00:00Z" })]);
    expect(lessonNav(ls, "k1", DATE, "kah")).toBeNull();
  });

  it("a cancelled lesson is still a stop", () => {
    const ls = lessons([...KAH], {
      sessions: [{ id: "c", class_id: "k2", session_date: DATE, off_schedule_reason: null, cancelled_at: "2026-08-10T00:00:00Z", cancellation_reason: "pool closed" }],
    });
    expect(walkLessons(ls, "k1", "kah")).toEqual(["k1", "k2", "k3"]);
  });
});

function baseInput(classes: CalendarClass[]): BuildInput {
  return {
    range: { from: DATE, to: DATE },
    today: "2026-08-19",
    nowMinutes: 12 * 60,
    classes,
    sessions: [],
    enrolments: [],
    bookings: [],
    attendance: [],
    substitutes: [],
    classRates: classes.map((c) => ({ class_id: c.id, effective_from: "2000-01-01", paid_coach_id: c.coach_id })),
    shadows: [],
    absences: [],
    coachNames: new Map([["kah", "Kah Hang"]]),
    holidays: [],
  };
}
