import { describe, it, expect } from "vitest";
import {
  addDays,
  mondayOf,
  timeToMinutes,
  rangeForView,
  monthGridDates,
  shiftAnchor,
  buildCalendarLessons,
  layoutLanes,
  chunk,
  timeAxis,
  formatCount,
  isFull,
  effectiveCapacity,
  locationOptions,
  type BuildInput,
  type CalendarClass,
} from "./calendarLessons";
import { expectedStudentsOn, type EnrolmentSpan } from "./attendanceCompleteness";
import { toSgDate } from "./lessonDates";

// ── dates ────────────────────────────────────────────────────────────────────

describe("date helpers", () => {
  it("addDays crosses month and year ends", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("bad", 1)).toBe("");
  });

  it("mondayOf is Monday-first (a Sunday belongs to the week before it)", () => {
    expect(mondayOf("2026-08-19")).toBe("2026-08-17"); // Wed
    expect(mondayOf("2026-08-17")).toBe("2026-08-17"); // Mon
    expect(mondayOf("2026-08-23")).toBe("2026-08-17"); // Sun
  });

  it("timeToMinutes reads HH:MM and HH:MM:SS", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("10:00:00")).toBe(600);
    expect(timeToMinutes("")).toBe(0);
  });
});

describe("rangeForView / shiftAnchor / monthGridDates", () => {
  it("day, week (Mon..Sun), agenda (7 days from anchor)", () => {
    expect(rangeForView("day", "2026-08-19")).toEqual({ from: "2026-08-19", to: "2026-08-19" });
    expect(rangeForView("week", "2026-08-19")).toEqual({ from: "2026-08-17", to: "2026-08-23" });
    expect(rangeForView("agenda", "2026-08-19")).toEqual({ from: "2026-08-19", to: "2026-08-25" });
  });

  it("month grid is 42 days starting the Monday on/before the 1st", () => {
    const g = monthGridDates("2026-08-19");
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-07-27"); // 1 Aug 2026 is a Saturday
    expect(g[41]).toBe("2026-09-06");
    expect(rangeForView("month", "2026-08-19")).toEqual({ from: "2026-07-27", to: "2026-09-06" });
    // A month starting on Monday starts the grid on the 1st
    expect(monthGridDates("2026-06-15")[0]).toBe("2026-06-01");
  });

  it("shiftAnchor: day ±1, week/agenda ±7, month → day 1 of the neighbour (never the 31st of a 30-day month)", () => {
    expect(shiftAnchor("day", "2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftAnchor("week", "2026-08-19", -1)).toBe("2026-08-12");
    expect(shiftAnchor("agenda", "2026-08-19", 1)).toBe("2026-08-26");
    expect(shiftAnchor("month", "2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
  });
});

// ── buildCalendarLessons ─────────────────────────────────────────────────────

const MON_CLASS: CalendarClass = {
  id: "c1",
  title: "Mon Beginners",
  day_of_week: "monday",
  start_time: "10:00:00",
  end_time: "11:00:00",
  location_name: "Clementi",
  coach_id: "coachA",
  colour: "sky",
  capacity: null,
  category_default_capacity: 6,
  is_active: true,
  deactivated_at: null,
};

const BASE: BuildInput = {
  range: { from: "2026-08-03", to: "2026-08-23" },
  today: "2026-08-19",
  nowMinutes: 12 * 60,
  classes: [MON_CLASS],
  sessions: [],
  enrolments: [
    // SGT-dated spans: 2026-07-31T16:00Z = 2026-08-01 00:00 SGT
    { student_id: "s1", class_id: "c1", enrolled_at: "2026-07-31T16:00:00Z", unenrolled_at: null, full_name: "S One" },
    { student_id: "s2", class_id: "c1", enrolled_at: "2026-07-31T16:00:00Z", unenrolled_at: null, full_name: "S Two" },
  ],
  bookings: [],
  attendance: [],
  substitutes: [],
  classRates: [{ class_id: "c1", effective_from: "2000-01-01", paid_coach_id: "coachA" }],
  shadows: [],
  absences: [],
  coachNames: new Map([
    ["coachA", "Coach A"],
    ["coachB", "Coach B"],
  ]),
  holidays: [],
};

function build(over: Partial<BuildInput> = {}) {
  return buildCalendarLessons({ ...BASE, ...over });
}

describe("buildCalendarLessons — dates", () => {
  it("derives every Monday in range from the pattern when no session rows exist", () => {
    const dates = build().map((l) => l.date);
    expect(dates).toEqual(["2026-08-03", "2026-08-10", "2026-08-17"]);
  });

  it("adds an off-pattern session row (extra lesson) and flags it", () => {
    const out = build({
      sessions: [{ id: "sx", class_id: "c1", session_date: "2026-08-12", off_schedule_reason: "make-up" }],
    });
    const extra = out.find((l) => l.date === "2026-08-12")!;
    expect(extra.offPattern).toBe(true);
    expect(extra.sessionId).toBe("sx");
    expect(out.find((l) => l.date === "2026-08-10")!.offPattern).toBe(false);
  });

  it("ignores session rows outside the range", () => {
    const out = build({
      sessions: [{ id: "sx", class_id: "c1", session_date: "2026-09-12", off_schedule_reason: null }],
    });
    expect(out.map((l) => l.date)).not.toContain("2026-09-12");
  });

  // ⚠ RISK 6: the retirement cut-off is the SGT date, like the engine (core.ts),
  // not `::date` (UTC) as in mark_day_holiday.
  it("retired class: cut-off is the SGT date of deactivated_at", () => {
    // 2026-08-10T16:30Z = 2026-08-11 00:30 SGT → the Monday 10th still shows, the 17th does not
    const a = build({ classes: [{ ...MON_CLASS, is_active: false, deactivated_at: "2026-08-10T16:30:00Z" }] });
    expect(a.map((l) => l.date)).toEqual(["2026-08-03", "2026-08-10"]);
    // 2026-08-10T15:30Z = 2026-08-10 23:30 SGT → cut-off IS the 10th: neither shows
    const b = build({ classes: [{ ...MON_CLASS, is_active: false, deactivated_at: "2026-08-10T15:30:00Z" }] });
    expect(b.map((l) => l.date)).toEqual(["2026-08-03"]);
  });

  it("retired class: an EXISTING session row on/after the cut-off still shows (it happened)", () => {
    const out = build({
      classes: [{ ...MON_CLASS, is_active: false, deactivated_at: "2026-08-05T00:00:00Z" }],
      sessions: [{ id: "s10", class_id: "c1", session_date: "2026-08-10", off_schedule_reason: null }],
    });
    expect(out.map((l) => l.date)).toEqual(["2026-08-03", "2026-08-10"]);
  });
});

describe("buildCalendarLessons — the count IS the billing gate's expected set (RISK 3)", () => {
  const spansInput: BuildInput = {
    ...BASE,
    enrolments: [
      ...BASE.enrolments,
      // (a) left before the date: unenrolled 2026-08-09 23:00 SGT
      { student_id: "s3", class_id: "c1", enrolled_at: "2026-07-31T16:00:00Z", unenrolled_at: "2026-08-09T15:00:00Z", full_name: "S Three" },
      // (b) enrolled AND trial-booked the same day (booking never cancelled)
      { student_id: "s4", class_id: "c1", enrolled_at: "2026-08-09T16:00:00Z", unenrolled_at: null, full_name: "S Four" },
    ],
    bookings: [
      { kind: "trial", student_id: "s4", class_id: "c1", session_date: "2026-08-10", cancelled_at: null, full_name: "S Four" },
      { kind: "makeup", student_id: "g1", class_id: "c1", session_date: "2026-08-10", cancelled_at: null, full_name: "Guest One" },
      // (c) cancelled make-up
      { kind: "makeup", student_id: "g2", class_id: "c1", session_date: "2026-08-10", cancelled_at: "2026-08-09T00:00:00Z", full_name: "Guest Two" },
      // a booking on another host class does not count here
      { kind: "trial", student_id: "g3", class_id: "cOther", session_date: "2026-08-10", cancelled_at: null, full_name: "Elsewhere" },
    ],
  };

  it("(a) excluded, (b) once, (c) excluded — enrolled 3, guests 1 on the 10th", () => {
    const l = build(spansInput).find((x) => x.date === "2026-08-10")!;
    expect(l.enrolled).toBe(3); // s1, s2, s4 (s3 left the day before)
    expect(l.guests).toBe(1); // g1 only
    expect(l.students.map((s) => s.id).sort()).toEqual(["g1", "s1", "s2", "s4"]);
    expect(l.students.find((s) => s.id === "g1")!.kind).toBe("makeup");
    expect(l.students.find((s) => s.id === "s4")!.kind).toBe("enrolled");
  });

  it("enrolled + guests === expectedStudentsOn(...) for every lesson (parity assertion)", () => {
    const out = build(spansInput);
    const spans: EnrolmentSpan[] = spansInput.enrolments.map((e) => ({
      studentId: e.student_id,
      from: toSgDate(e.enrolled_at),
      until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
    }));
    for (const l of out) {
      const booked = new Map<string, string[]>();
      for (const b of spansInput.bookings) {
        if (b.cancelled_at || b.class_id !== l.classId) continue;
        booked.set(b.session_date, [...(booked.get(b.session_date) ?? []), b.student_id]);
      }
      expect(l.enrolled + l.guests).toBe(expectedStudentsOn(l.date, spans, booked).length);
    }
  });

  it("s3's old enrolment still counts on the 3rd (span, not is_active)", () => {
    const l = build(spansInput).find((x) => x.date === "2026-08-03")!;
    expect(l.enrolled).toBe(3); // s1, s2, s3
  });
});

describe("buildCalendarLessons — progress", () => {
  const session = { id: "s17", class_id: "c1", session_date: "2026-08-17", off_schedule_reason: null };

  it("past lesson with no session → unmarked; future → upcoming; today after end-time → unmarked, before → upcoming", () => {
    const past = build().find((l) => l.date === "2026-08-17")!;
    expect(past.progress).toBe("unmarked");
    const today = build({ today: "2026-08-17", nowMinutes: 10 * 60 + 30 }).find((l) => l.date === "2026-08-17")!;
    expect(today.progress).toBe("upcoming");
    const todayAfter = build({ today: "2026-08-17", nowMinutes: 11 * 60 }).find((l) => l.date === "2026-08-17")!;
    expect(todayAfter.progress).toBe("unmarked");
    const future = build({ today: "2026-08-01" }).find((l) => l.date === "2026-08-17")!;
    expect(future.progress).toBe("upcoming");
  });

  it("partial / complete by expected students only; a leaver's row does not count", () => {
    const partial = build({
      sessions: [session],
      attendance: [{ lesson_session_id: "s17", student_id: "s1", status: "present" }],
    }).find((l) => l.date === "2026-08-17")!;
    expect(partial.progress).toBe("partial");
    expect(partial.marked).toBe(1);
    expect(partial.students.find((s) => s.id === "s1")!.status).toBe("present");
    expect(partial.students.find((s) => s.id === "s2")!.status).toBeNull();

    const complete = build({
      sessions: [session],
      attendance: [
        { lesson_session_id: "s17", student_id: "s1", status: "present" },
        { lesson_session_id: "s17", student_id: "s2", status: "absent" },
        { lesson_session_id: "s17", student_id: "zombie", status: "present" },
      ],
    }).find((l) => l.date === "2026-08-17")!;
    expect(complete.progress).toBe("complete");
    expect(complete.marked).toBe(2);
  });

  it("every expected student marked holiday → holiday; a public-holiday name is attached from the calendar", () => {
    const out = build({
      sessions: [session],
      attendance: [
        { lesson_session_id: "s17", student_id: "s1", status: "holiday" },
        { lesson_session_id: "s17", student_id: "s2", status: "holiday" },
      ],
      holidays: [{ holiday_date: "2026-08-17", name: "Test Day" }],
    });
    const l = out.find((x) => x.date === "2026-08-17")!;
    expect(l.progress).toBe("holiday");
    expect(l.holidayName).toBe("Test Day");
    expect(out.find((x) => x.date === "2026-08-10")!.holidayName).toBeNull();
  });

  it("no enrolments and no bookings → no-students", () => {
    expect(build({ enrolments: [] })[0].progress).toBe("no-students");
  });
});

describe("buildCalendarLessons — coaches (money axis, §7.152)", () => {
  it("main coach is the class_rates paid coach on the date, not classes.coach_id", () => {
    const out = build({
      classRates: [
        { class_id: "c1", effective_from: "2000-01-01", paid_coach_id: "coachA" },
        { class_id: "c1", effective_from: "2026-08-15", paid_coach_id: "coachB" },
      ],
    });
    expect(out.find((l) => l.date === "2026-08-10")!.mainCoach.name).toBe("Coach A");
    expect(out.find((l) => l.date === "2026-08-17")!.mainCoach.name).toBe("Coach B");
    expect(out.every((l) => !l.mainCoach.isCover && l.subName === null)).toBe(true);
  });

  it("a substitute on a session is the main, flagged cover, named as sub", () => {
    const out = build({
      sessions: [{ id: "s10", class_id: "c1", session_date: "2026-08-10", off_schedule_reason: null }],
      substitutes: [{ lesson_session_id: "s10", coach_id: "coachB" }],
    });
    const l = out.find((x) => x.date === "2026-08-10")!;
    expect(l.mainCoach).toEqual({ id: "coachB", name: "Coach B", isCover: true });
    expect(l.subName).toBe("Coach B");
  });

  it("a class shadow in its window is listed by name, absent shadows are not", () => {
    const out = build({
      sessions: [{ id: "s10", class_id: "c1", session_date: "2026-08-10", off_schedule_reason: null }],
      shadows: [{ class_id: "c1", coach_id: "coachB", effective_from: "2026-08-01", effective_to: null }],
      absences: [{ lesson_session_id: "s10", coach_id: "coachB" }],
    });
    expect(out.find((x) => x.date === "2026-08-03")!.shadowNames).toEqual(["Coach B"]);
    expect(out.find((x) => x.date === "2026-08-10")!.shadowNames).toEqual([]);
  });
});

describe("capacity + count formatting", () => {
  it("effectiveCapacity prefers the class, then the category, else null", () => {
    expect(effectiveCapacity({ capacity: 4, category_default_capacity: 6 })).toBe(4);
    expect(effectiveCapacity({ capacity: null, category_default_capacity: 6 })).toBe(6);
    expect(effectiveCapacity({ capacity: null, category_default_capacity: null })).toBeNull();
  });

  it("formatCount follows the 2+1 convention", () => {
    expect(formatCount(4, 1, 6)).toBe("4+1/6");
    expect(formatCount(4, 0, 6)).toBe("4/6");
    expect(formatCount(4, 1, null)).toBe("4+1");
    expect(formatCount(0, 0, null)).toBe("0");
  });

  it("isFull counts guests", () => {
    expect(isFull(5, 1, 6)).toBe(true);
    expect(isFull(5, 0, 6)).toBe(false);
    expect(isFull(99, 0, null)).toBe(false);
  });

  it("the built lesson carries the effective capacity", () => {
    expect(build()[0].capacity).toBe(6);
    expect(build({ classes: [{ ...MON_CLASS, capacity: 4 }] })[0].capacity).toBe(4);
  });
});

describe("layoutLanes", () => {
  const L = (key: string, s: number, e: number) => ({ key, startMin: s, endMin: e });

  it("three overlapping → three lanes; disjoint → one lane each", () => {
    const m = layoutLanes([L("a", 600, 660), L("b", 600, 645), L("c", 630, 690), L("d", 700, 760)]);
    // same start → the shorter one is placed first (deterministic ordering)
    expect(m.get("b")).toEqual({ lane: 0, lanes: 3 });
    expect(m.get("a")).toEqual({ lane: 1, lanes: 3 });
    expect(m.get("c")).toEqual({ lane: 2, lanes: 3 });
    expect(m.get("d")).toEqual({ lane: 0, lanes: 1 });
  });

  it("a lesson starting exactly when another ends reuses its lane (touching is not overlapping)", () => {
    const m = layoutLanes([L("a", 600, 660), L("b", 660, 720)]);
    expect(m.get("a")!.lanes).toBe(1);
    expect(m.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("a chained overlap forms one cluster with the cluster's width on every card", () => {
    // a 9-10, b 9:30-10:30, c 10-11 → a and c do not overlap but share the cluster via b
    const m = layoutLanes([L("a", 540, 600), L("b", 570, 630), L("c", 600, 660)]);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(m.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(m.get("c")).toEqual({ lane: 0, lanes: 2 });
  });
});

describe("chunk / timeAxis / locationOptions", () => {
  it("chunk: 450 ids → 3 calls of ≤200 (RISK 10)", () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);
    const c = chunk(ids, 200);
    expect(c.map((x) => x.length)).toEqual([200, 200, 50]);
    expect(c.flat()).toEqual(ids);
    expect(chunk([], 200)).toEqual([]);
  });

  it("timeAxis is at least 08:00–20:00 and stretches by 30 min around lessons", () => {
    expect(timeAxis([])).toEqual({ startMin: 480, endMin: 1200 });
    expect(timeAxis([{ startMin: 7 * 60, endMin: 8 * 60 }])).toEqual({ startMin: 390, endMin: 1200 });
    expect(timeAxis([{ startMin: 20 * 60, endMin: 21 * 60 + 15 }])).toEqual({ startMin: 480, endMin: 1320 });
    expect(timeAxis([{ startMin: 0, endMin: 24 * 60 }])).toEqual({ startMin: 0, endMin: 1440 });
  });

  it("locationOptions is distinct, trimmed, sorted", () => {
    expect(locationOptions([{ location_name: "Clementi " }, { location_name: "Bedok" }, { location_name: "Clementi" }, { location_name: " " }]))
      .toEqual(["Bedok", "Clementi"]);
  });
});
