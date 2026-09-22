// CHARACTERISATION test (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 2): pins what the
// Schedule tab's per-class loop already did when it moved out of loadData —
// the week's cards, the floor-scoped NEEDS MARKING set (which feeds billing,
// §8i) and the covered-out probe list. §7.25's prove-it-red rule does not
// apply — there is no fix, only a move.
//
// Every timestamp spells its offset (§7.227): toSgDate runs INSIDE
// buildSchedule, so a bare `Z` near midnight would be the next SG day and a
// case could pass for the wrong reason.
//
// Calendar used: 2026-09-21 is a Monday.
import { buildSchedule, applyCoveredOut, type ScheduleInput } from "./scheduleRows";
import { sessionIndex, bookedIndex, type CoachClass } from "./scheduleIndex";
import type { BacklogItem, WeekLesson } from "../types";

const cls = (id: string, day: string, enrolled: string[] = [], extra: Record<string, unknown> = {}) => ({
  id,
  title: `Class ${id}`,
  day_of_week: day,
  start_time: "16:00:00",
  end_time: "17:00:00",
  location_id: "loc1",
  locations: { name: "Pool" },
  student_class_enrolments: enrolled.map((sid) => ({
    student_id: sid,
    is_active: true,
    enrolled_at: "2026-09-01T08:00:00+08:00",
    unenrolled_at: null,
  })),
  ...extra,
});

function input(over: Partial<ScheduleInput> & { sessions?: any[]; bookings?: any[] }): ScheduleInput {
  const { sessionByClassDate, sessionDatesByClass } = sessionIndex(over.sessions ?? []);
  return {
    coachClasses: [],
    sessionByClassDate,
    sessionDatesByClass,
    bookedByClassDate: bookedIndex(over.bookings ?? [], []),
    rosteredDates: new Map(),
    assignmentByLesson: new Map(),
    weekStart: "2026-09-21",
    weekEnd: "2026-09-27",
    backlogFrom: "2026-09-01",
    todayDate: "2026-09-23",
    nowMins: 12 * 60,
    ...over,
  };
}
const owned = (c: any): CoachClass => ({ cls: c, owned: true, shadowed: false });
const covered = (c: any): CoachClass => ({ cls: c, owned: false, shadowed: false });
const shadowed = (c: any): CoachClass => ({ cls: c, owned: false, shadowed: true });
const dates = (xs: { date: string }[]) => xs.map((x) => x.date);

describe("buildSchedule (characterisation)", () => {
  it("1. owned class: the weekday recurrence, plus an off-weekday session date and a booking date", () => {
    const r = buildSchedule(
      input({
        coachClasses: [owned(cls("c1", "monday", ["s1"]))],
        sessions: [{ id: "x", class_id: "c1", session_date: "2026-09-24", cancelled_at: null, attendance: [] }],
        bookings: [{ class_id: "c1", student_id: "g1", session_date: "2026-09-26" }],
      })
    );
    expect(dates(r.lessons)).toEqual(["2026-09-21", "2026-09-24", "2026-09-26"]);
    expect(r.lessons.every((l) => l.role === "owner")).toBe(true);
  });

  it("2. covered class: ONLY the rostered dates, never the recurrence", () => {
    const r = buildSchedule(
      input({
        coachClasses: [covered(cls("c2", "tuesday", ["s1"]))],
        rosteredDates: new Map([["c2", ["2026-09-22"]]]),
        assignmentByLesson: new Map([["c2:2026-09-22", {}]]),
      })
    );
    expect(dates(r.lessons)).toEqual(["2026-09-22"]);
    expect(r.lessons[0].role).toBe("cover");
  });

  it("3a. shadowed class, no assignment: whole recurrence as `shadow`, never nagged, never probed", () => {
    const r = buildSchedule(
      input({
        coachClasses: [shadowed(cls("c3", "monday", ["s1"]))],
        // An unfinished session in the week: an OWNED class would probe it.
        sessions: [{ id: "sess21", class_id: "c3", session_date: "2026-09-21", cancelled_at: null, attendance: [] }],
      })
    );
    expect(dates(r.lessons)).toEqual(["2026-09-21"]);
    expect(r.lessons[0].role).toBe("shadow");
    expect(r.backlogItems).toEqual([]); // 7 and 14 Sep are unmarked, but not mine to clear
    expect(r.probeIds).toEqual([]);
  });

  it("3b. shadowed class + a substitute row on ONE date: SUBSTITUTE BEATS SHADOW — that date is nagged, still not probed", () => {
    const r = buildSchedule(
      input({
        coachClasses: [shadowed(cls("c3", "monday", ["s1"]))],
        rosteredDates: new Map([["c3", ["2026-09-14"]]]),
        assignmentByLesson: new Map([["c3:2026-09-14", {}]]),
        sessions: [{ id: "sess14", class_id: "c3", session_date: "2026-09-14", cancelled_at: null, attendance: [] }],
      })
    );
    expect(dates(r.backlogItems)).toEqual(["2026-09-14"]);
    expect(r.probeIds).toEqual([]); // `owned` is false
  });

  it("4. backlog: unmarked past lessons in, fully marked out, today's out until it ENDS", () => {
    const base = {
      coachClasses: [owned(cls("c1", "monday", ["s1"]))],
      todayDate: "2026-09-21",
      sessions: [
        {
          id: "sess14",
          class_id: "c1",
          session_date: "2026-09-14",
          cancelled_at: null,
          attendance: [{ student_id: "s1", status: "present" }],
        },
      ],
    };
    const before = buildSchedule(input({ ...base, nowMins: 16 * 60 }));
    expect(dates(before.backlogItems)).toEqual(["2026-09-07"]);
    expect(before.backlogItems[0].progress).toEqual({ kind: "unmarked" });

    const after = buildSchedule(input({ ...base, nowMins: 18 * 60 }));
    expect(dates(after.backlogItems)).toEqual(["2026-09-07", "2026-09-21"]);
  });

  it("4b. backlog: a class nobody is expected at is never nagged", () => {
    const r = buildSchedule(input({ coachClasses: [owned(cls("c1", "monday", []))] }));
    expect(r.backlogItems).toEqual([]);
    expect(r.lessons[0].progress).toEqual({ kind: "no-students" });
  });

  it("5. §7.97: a trial booked BEFORE the class's first enrolment, above the floor, is IN the backlog", () => {
    const c = cls("c5", "wednesday");
    c.student_class_enrolments = [
      { student_id: "s1", is_active: true, enrolled_at: "2026-08-01T08:00:00+08:00", unenrolled_at: null },
    ];
    const r = buildSchedule(
      input({
        coachClasses: [owned(c)],
        bookings: [{ class_id: "c5", student_id: "t1", session_date: "2026-07-15" }],
        backlogFrom: "2026-07-01",
        weekStart: "2026-08-17",
        weekEnd: "2026-08-23",
        todayDate: "2026-08-20",
        nowMins: 0,
      })
    );
    const trial = r.backlogItems.find((b) => b.date === "2026-07-15");
    expect(trial?.progress).toEqual({ kind: "unmarked" });
    // No other July Wednesday: nobody was expected (the expected.length === 0 suppression).
    expect(dates(r.backlogItems).filter((d) => d.startsWith("2026-07"))).toEqual(["2026-07-15"]);
    expect(dates(r.backlogItems)).toEqual(["2026-07-15", "2026-08-05", "2026-08-12", "2026-08-19"]);
  });

  it("6. an admin-cancelled lesson owes enrolled students nothing — but a guest on it is still owed a mark", () => {
    const sessions = [{ id: "c14", class_id: "c1", session_date: "2026-09-14", cancelled_at: "2026-09-10T10:00:00+08:00", attendance: [] }];
    const plain = buildSchedule(input({ coachClasses: [owned(cls("c1", "monday", ["s1"]))], sessions }));
    expect(dates(plain.backlogItems)).toEqual(["2026-09-07", "2026-09-21"]); // 14th: cancelled, nobody owed

    const withGuest = buildSchedule(
      input({
        coachClasses: [owned(cls("c1", "monday", ["s1"]))],
        sessions,
        bookings: [{ class_id: "c1", student_id: "g1", session_date: "2026-09-14" }],
      })
    );
    expect(dates(withGuest.backlogItems)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
  });

  it("7. probeIds: a lesson in BOTH the week and the backlog is pushed TWICE (week pass first), raw", () => {
    const r = buildSchedule(
      input({
        coachClasses: [owned(cls("c1", "monday", ["s1"]))],
        todayDate: "2026-09-21",
        nowMins: 18 * 60,
        backlogFrom: "2026-09-21",
        sessions: [{ id: "sess21", class_id: "c1", session_date: "2026-09-21", cancelled_at: null, attendance: [] }],
      })
    );
    expect(r.probeIds).toEqual(["sess21", "sess21"]);
  });

  it("10. a card's students + guests split sums to who is expected (the 2+1 rule)", () => {
    const r = buildSchedule(
      input({
        coachClasses: [owned(cls("c1", "monday", ["s1", "s2"]))],
        bookings: [{ class_id: "c1", student_id: "g1", session_date: "2026-09-21" }],
      })
    );
    const card = r.lessons.find((l) => l.date === "2026-09-21")!;
    expect([card.students, card.guests]).toEqual([2, 1]);
  });
});

describe("applyCoveredOut (characterisation) — case 8", () => {
  const item = (date: string, session_id: string | null): BacklogItem => ({
    class_id: "c1",
    class_title: "C",
    date,
    session_id,
    progress: { kind: "unmarked" },
    summary: "",
  });
  const card = (sessionId: string | null, role: WeekLesson["role"]): WeekLesson =>
    ({ classId: "c1", date: "2026-09-21", sessionId, role } as WeekLesson);

  it("a covered-out session leaves the backlog; an OWNER card flips to `covered`; others untouched; newest first", () => {
    const r = applyCoveredOut(
      [item("2026-09-07", "a"), item("2026-09-14", "b"), item("2026-09-01", null)],
      [card("b", "owner"), card("b", "shadow"), card("c", "owner")],
      new Set(["b"])
    );
    expect(dates(r.ownBacklog)).toEqual(["2026-09-07", "2026-09-01"]);
    expect(r.weekCards.map((c) => c.role)).toEqual(["covered", "shadow", "owner"]);
  });
});
