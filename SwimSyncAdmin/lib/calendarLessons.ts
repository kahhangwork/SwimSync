// The admin calendar's pure core: turn raw rows into one described lesson per
// (class, date) for a date range, lay overlapping lessons into lanes, and turn a
// view + anchor date into a range. No Supabase, no clock — `today` and
// `nowMinutes` are passed in so every rule here is unit-testable and the page
// never holds a date in state (§7.95).
//
// ⚠ THE CALENDAR NEVER WRITES. Nothing in this file, `calendarData.ts` or any
// calendar component creates a `lesson_sessions` row: a session row is the
// billing engine's "a lesson happened here" signal, and a phantom row on a date
// the class never ran is a billable lesson. The only writer is the lesson page.
//
// THE COUNT IS THE BILLING GATE'S EXPECTED SET, BY CONSTRUCTION. `enrolled` is
// `studentsEnrolledOn` (enrolment SPANS — never `is_active`), `guests` is
// `expectedStudentsOn(...) − enrolled` (uncancelled trial + make-up bookings by
// HOST class, deduped against enrolment). A make-up slot judged on a number the
// gate disagrees with is how a child is over-slotted; so the number is not
// re-derived here, it is the shared function (§7.18).

import {
  expectedStudentsOn,
  studentsEnrolledOn,
  countMarked,
  type EnrolmentSpan,
} from "./attendanceCompleteness";
import {
  attributeLessons,
  type AbsenceRow,
  type ClassRateRow,
  type ClassShadowRow,
  type SubstituteRow,
} from "./lessonAttribution";
import {
  expectedLessonDates,
  dayOfWeekOf,
  toSgDate,
  type DayOfWeek,
} from "./lessonDates";

// ── Date arithmetic on "YYYY-MM-DD" (UTC-noon anchored, DST-free) ───────────

const DAY_MS = 86_400_000;

function parse(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** `date` + n days (n may be negative). Malformed input → "" . */
export function addDays(date: string, n: number): string {
  const ms = parse(date);
  if (Number.isNaN(ms)) return "";
  return fmt(ms + n * DAY_MS);
}

/** The Monday on or before `date` (Monday-first weeks, like the coach app). */
export function mondayOf(date: string): string {
  const ms = parse(date);
  if (Number.isNaN(ms)) return "";
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return fmt(ms - back * DAY_MS);
}

/** "HH:MM" or "HH:MM:SS" → minutes since midnight. Malformed → 0. */
export function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ── Views and ranges ────────────────────────────────────────────────────────

export type CalendarView = "day" | "week" | "month" | "agenda";

export const CALENDAR_VIEWS: readonly CalendarView[] = ["day", "week", "month", "agenda"];

export function isCalendarView(v: string | null | undefined): v is CalendarView {
  return v === "day" || v === "week" || v === "month" || v === "agenda";
}

export type DateRange = { from: string; to: string };

/**
 * The inclusive date range a view shows around `anchor`.
 *   day    — the day
 *   week   — Monday..Sunday containing it
 *   month  — the 6×7 Monday-first grid holding the month (leading/trailing days included)
 *   agenda — 7 days from the anchor
 */
export function rangeForView(view: CalendarView, anchor: string): DateRange {
  switch (view) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const mon = mondayOf(anchor);
      return { from: mon, to: addDays(mon, 6) };
    }
    case "month": {
      const grid = monthGridDates(anchor);
      return { from: grid[0], to: grid[grid.length - 1] };
    }
    case "agenda":
      return { from: anchor, to: addDays(anchor, 6) };
  }
}

/** The 42 dates of the Monday-first month grid containing `anchor`. */
export function monthGridDates(anchor: string): string[] {
  const ms = parse(anchor);
  if (Number.isNaN(ms)) return [];
  const d = new Date(ms);
  const first = fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const start = mondayOf(first);
  const out: string[] = [];
  for (let i = 0; i < 42; i++) out.push(addDays(start, i));
  return out;
}

/** The anchor one step forward (+1) or back (−1) for a view. */
export function shiftAnchor(view: CalendarView, anchor: string, dir: 1 | -1): string {
  switch (view) {
    case "day":
      return addDays(anchor, dir);
    case "week":
    case "agenda":
      return addDays(anchor, 7 * dir);
    case "month": {
      const ms = parse(anchor);
      if (Number.isNaN(ms)) return anchor;
      const d = new Date(ms);
      // Day 1 of the target month — never "the 31st of a 30-day month".
      return fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1));
    }
  }
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export type CalendarClass = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  location_name: string;
  coach_id: string;
  colour: string | null;
  capacity: number | null;
  category_default_capacity: number | null;
  is_active: boolean;
  /** ISO timestamp. Lessons on/after its SGT date are not shown (the engine's
   *  cut-off — `toSgDate`, never `::date`, §7.7). */
  deactivated_at: string | null;
};

export type CalendarSession = {
  id: string;
  class_id: string;
  session_date: string;
  off_schedule_reason: string | null;
  /** Set when the admin cancelled the lesson in advance (cancel_lesson,
   *  20260821000700). A cancelled lesson expects nobody enrolled and is shown
   *  faded + "Cancelled", like a holiday void. */
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

export type CalendarEnrolment = {
  student_id: string;
  class_id: string;
  /** ISO timestamps. Converted to SGT dates here, inclusive both ends. */
  enrolled_at: string;
  unenrolled_at: string | null;
  full_name: string;
};

export type CalendarBooking = {
  kind: "trial" | "makeup";
  student_id: string;
  /** The HOST class — the lesson the child is expected at. Never home_class_id. */
  class_id: string;
  session_date: string;
  cancelled_at: string | null;
  full_name: string;
};

export type CalendarAttendance = {
  lesson_session_id: string;
  student_id: string;
  status: string;
};

export type CalendarHoliday = { holiday_date: string; name: string };

export type LessonProgress = "upcoming" | "unmarked" | "partial" | "complete" | "holiday" | "no-students" | "cancelled";

export type CalendarStudent = {
  id: string;
  name: string;
  kind: "enrolled" | "trial" | "makeup";
  /** The attendance status, or null when unmarked. */
  status: string | null;
};

export type CalendarLesson = {
  /** `${classId}|${date}` — stable without a session row. */
  key: string;
  classId: string;
  date: string;
  /** Null until the first mark creates it. */
  sessionId: string | null;
  start: string;
  end: string;
  startMin: number;
  endMin: number;
  title: string;
  location: string;
  colourKey: string | null;
  capacity: number | null;
  enrolled: number;
  guests: number;
  mainCoach: { id: string | null; name: string; isCover: boolean };
  /** The named substitute when it is a cover — shown in red beside the coach. */
  subName: string | null;
  shadowNames: string[];
  progress: LessonProgress;
  marked: number;
  offPattern: boolean;
  holidayName: string | null;
  /** The admin's reason when `progress === "cancelled"`; null otherwise. */
  cancellationReason: string | null;
  students: CalendarStudent[];
};

export type BuildInput = {
  range: DateRange;
  today: string;
  /** Minutes since midnight in SGT; decides whether TODAY's lesson has ended. */
  nowMinutes: number;
  classes: readonly CalendarClass[];
  sessions: readonly CalendarSession[];
  enrolments: readonly CalendarEnrolment[];
  bookings: readonly CalendarBooking[];
  attendance: readonly CalendarAttendance[];
  substitutes: readonly SubstituteRow[];
  classRates: readonly ClassRateRow[];
  shadows: readonly ClassShadowRow[];
  absences: readonly AbsenceRow[];
  coachNames: ReadonlyMap<string, string>;
  holidays: readonly CalendarHoliday[];
};

/** Effective capacity: the class's own, else its category's, else null. */
export function effectiveCapacity(c: {
  capacity: number | null;
  category_default_capacity: number | null;
}): number | null {
  return c.capacity ?? c.category_default_capacity ?? null;
}

/** "4+1/6" — the roster convention (PRD §7.3); "4/6" with no guests; "4+1" unlimited. */
export function formatCount(enrolled: number, guests: number, capacity: number | null): string {
  const head = guests > 0 ? `${enrolled}+${guests}` : `${enrolled}`;
  return capacity == null ? head : `${head}/${capacity}`;
}

export function isFull(enrolled: number, guests: number, capacity: number | null): boolean {
  return capacity != null && enrolled + guests >= capacity;
}

/**
 * Every lesson of every class inside `range`, described.
 *
 * Dates per class = the weekday pattern ∪ existing session rows (both halves
 * load-bearing — see `lessonDatesInMonth` in sessionRoster.ts), minus any date
 * on/after the class's SGT retirement date.
 */
export function buildCalendarLessons(input: BuildInput): CalendarLesson[] {
  const { range, today, nowMinutes } = input;

  const sessionsByClass = new Map<string, CalendarSession[]>();
  for (const s of input.sessions) {
    if (s.session_date < range.from || s.session_date > range.to) continue;
    const list = sessionsByClass.get(s.class_id);
    if (list) list.push(s);
    else sessionsByClass.set(s.class_id, [s]);
  }

  // Enrolment spans per class, SGT dates, inclusive.
  const spansByClass = new Map<string, EnrolmentSpan[]>();
  const studentName = new Map<string, string>();
  for (const e of input.enrolments) {
    studentName.set(e.student_id, e.full_name);
    const span: EnrolmentSpan = {
      studentId: e.student_id,
      from: toSgDate(e.enrolled_at),
      until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
    };
    const list = spansByClass.get(e.class_id);
    if (list) list.push(span);
    else spansByClass.set(e.class_id, [span]);
  }

  // Live bookings per (host class, date), for expectedStudentsOn's bookedByDate.
  const bookedByClassDate = new Map<string, Map<string, string[]>>();
  const bookingKind = new Map<string, "trial" | "makeup">(); // `${classId}|${date}|${studentId}`
  for (const b of input.bookings) {
    if (b.cancelled_at) continue;
    if (b.session_date < range.from || b.session_date > range.to) continue;
    studentName.set(b.student_id, b.full_name);
    let byDate = bookedByClassDate.get(b.class_id);
    if (!byDate) {
      byDate = new Map();
      bookedByClassDate.set(b.class_id, byDate);
    }
    const list = byDate.get(b.session_date);
    if (list) list.push(b.student_id);
    else byDate.set(b.session_date, [b.student_id]);
    bookingKind.set(`${b.class_id}|${b.session_date}|${b.student_id}`, b.kind);
  }

  const attendanceBySession = new Map<string, Map<string, string>>();
  for (const a of input.attendance) {
    let m = attendanceBySession.get(a.lesson_session_id);
    if (!m) {
      m = new Map();
      attendanceBySession.set(a.lesson_session_id, m);
    }
    m.set(a.student_id, a.status);
  }

  const holidayByDate = new Map(input.holidays.map((h) => [h.holiday_date, h.name]));

  // First pass: the (class, date) grid, so attribution can run once for all.
  type Draft = { cls: CalendarClass; date: string; session: CalendarSession | null };
  const drafts: Draft[] = [];
  for (const cls of input.classes) {
    const cutoff = cls.deactivated_at ? toSgDate(cls.deactivated_at) : null;
    const dates = new Set(expectedLessonDates(cls.day_of_week, range.from, range.to));
    const rows = sessionsByClass.get(cls.id) ?? [];
    for (const s of rows) dates.add(s.session_date);
    const sessionByDate = new Map(rows.map((s) => [s.session_date, s]));
    for (const date of [...dates].sort()) {
      // Retired: the engine stops expecting lessons ON the SGT retirement date
      // and after — but an EXISTING session row on such a date is a lesson that
      // happened (or was voided) and still shows.
      const session = sessionByDate.get(date) ?? null;
      if (cutoff && date >= cutoff && !session) continue;
      drafts.push({ cls, date, session });
    }
  }

  const attribution = attributeLessons({
    lessons: drafts.map((d) => ({
      lesson_session_id: d.session?.id ?? `${d.cls.id}|${d.date}`,
      class_id: d.cls.id,
      session_date: d.date,
    })),
    substitutes: input.substitutes,
    classRates: input.classRates,
    shadows: input.shadows,
    absences: input.absences,
  });

  const nameOf = (id: string | null) =>
    id ? input.coachNames.get(id) ?? "Unknown coach" : "—";

  const out: CalendarLesson[] = [];
  for (const { cls, date, session } of drafts) {
    const key = `${cls.id}|${date}`;
    const spans = spansByClass.get(cls.id) ?? [];
    const bookedByDate = bookedByClassDate.get(cls.id) ?? new Map<string, string[]>();
    // A lesson the admin cancelled in advance expects nobody ENROLLED — the
    // same substitution the engine's gate makes (core.ts `unmarkedOn`): spans
    // withheld, bookings kept (none can exist on a cancelled date; if one did
    // it must still show as an expected, unmarked guest).
    const cancelled = session?.cancelled_at != null;
    const enrolledIds = cancelled ? [] : studentsEnrolledOn(date, spans);
    const expectedIds = cancelled
      ? expectedStudentsOn(date, [], bookedByDate)
      : expectedStudentsOn(date, spans, bookedByDate);
    const enrolledSet = new Set(enrolledIds);
    const guests = expectedIds.length - enrolledIds.length;

    const marks = session ? attendanceBySession.get(session.id) : undefined;
    const markedSet = marks ? new Set(marks.keys()) : undefined;
    const marked = countMarked(expectedIds, markedSet);

    const startMin = timeToMinutes(cls.start_time);
    const endMin = timeToMinutes(cls.end_time);
    const hasEnded = date < today || (date === today && endMin <= nowMinutes);

    const students: CalendarStudent[] = expectedIds.map((id) => ({
      id,
      name: studentName.get(id) ?? "Unknown",
      kind: enrolledSet.has(id)
        ? "enrolled"
        : bookingKind.get(`${cls.id}|${date}|${id}`) ?? "trial",
      status: marks?.get(id) ?? null,
    }));

    let progress: LessonProgress;
    if (cancelled) progress = "cancelled";
    else if (expectedIds.length === 0) progress = "no-students";
    else if (marked > 0 && students.every((s) => s.status === "holiday")) progress = "holiday";
    else if (marked === 0) progress = hasEnded ? "unmarked" : "upcoming";
    else if (marked < expectedIds.length) progress = "partial";
    else progress = "complete";

    const attr = attribution.get(session?.id ?? key);
    const mainId = attr?.main_coach_id ?? null;
    const isCover = attr?.is_cover ?? false;

    out.push({
      key,
      classId: cls.id,
      date,
      sessionId: session?.id ?? null,
      start: cls.start_time.slice(0, 5),
      end: cls.end_time.slice(0, 5),
      startMin,
      endMin,
      title: cls.title,
      location: cls.location_name,
      colourKey: cls.colour,
      capacity: effectiveCapacity(cls),
      enrolled: enrolledIds.length,
      guests,
      mainCoach: { id: mainId, name: nameOf(mainId), isCover },
      subName: isCover ? nameOf(mainId) : null,
      shadowNames: (attr?.shadow_coach_ids ?? []).map((id) => nameOf(id)),
      progress,
      marked,
      offPattern: dayOfWeekOf(date) !== cls.day_of_week,
      holidayName: holidayByDate.get(date) ?? null,
      cancellationReason: cancelled ? session?.cancellation_reason ?? null : null,
      students,
    });
  }

  out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1
      : a.startMin - b.startMin || a.endMin - b.endMin || a.title.localeCompare(b.title)
  );
  return out;
}

// ── Lanes (day / week columns) ──────────────────────────────────────────────

export type LanePlacement = { lane: number; lanes: number };

/**
 * Interval packing: lessons that overlap in time share a cluster; within a
 * cluster each takes the lowest free lane, and `lanes` is the cluster's width.
 * Input is assumed to be ONE day's lessons (the caller groups by date).
 */
export function layoutLanes(
  lessons: readonly Pick<CalendarLesson, "key" | "startMin" | "endMin">[]
): Map<string, LanePlacement> {
  const sorted = [...lessons].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.key.localeCompare(b.key)
  );
  const out = new Map<string, LanePlacement>();
  let cluster: { key: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const width = laneEnds.length;
    for (const c of cluster) out.set(c.key, { lane: c.lane, lanes: width });
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const l of sorted) {
    if (cluster.length > 0 && l.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= l.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(l.endMin);
    } else {
      laneEnds[lane] = l.endMin;
    }
    cluster.push({ key: l.key, lane });
    clusterEnd = Math.max(clusterEnd, l.endMin);
  }
  flush();
  return out;
}

/** Split ids into ≤size chunks for `.in(...)` (PostgREST URL length). */
export function chunk<T>(items: readonly T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The time axis: 30-min rows from min(start)−30 … max(end)+30, at least 08:00–20:00. */
export function timeAxis(lessons: readonly Pick<CalendarLesson, "startMin" | "endMin">[]): {
  startMin: number;
  endMin: number;
} {
  let start = 8 * 60;
  let end = 20 * 60;
  for (const l of lessons) {
    start = Math.min(start, Math.floor((l.startMin - 30) / 30) * 30);
    end = Math.max(end, Math.ceil((l.endMin + 30) / 30) * 30);
  }
  return { startMin: Math.max(0, start), endMin: Math.min(24 * 60, end) };
}

/** Distinct, sorted location names (the Location filter's options). */
export function locationOptions(classes: readonly { location_name: string }[]): string[] {
  return [...new Set(classes.map((c) => c.location_name.trim()).filter(Boolean))].sort();
}
