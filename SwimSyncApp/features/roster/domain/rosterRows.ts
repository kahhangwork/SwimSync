// The PURE half of the roster screen's load (COACH_ROSTER_REFACTOR_PLAN.md,
// Stage 2) — every mapping `loadData` did between its awaits, moved verbatim
// out of app/(coach)/classes/[id]/roster.tsx so it can be pinned by
// characterisation tests (rosterRows.test.ts).
//
// ⚠ THIS IS THE BILLING GATE'S UNION, SEEN FROM THE POOLSIDE. Which lessons a
// coach sees as unmarked must agree with what generate-invoices blocks on
// (§7.18). Nothing here reads a clock: every date is passed in, because the
// screen reads TWO clocks at two different moments (`todayDate` at render,
// `today` after the bookings await) and collapsing them is a behaviour change.
//
// The raw rows are `any` because the supabase client is untyped — the same
// idiom the screen used inline.
import {
  toSgDate,
  type DayOfWeek,
} from "@/lib/lessonDates";
import { lessonDatesInRange } from "@/lib/scheduleWeek";
import {
  type EnrolmentSpan,
  expectedStudentsOn,
} from "@/lib/attendanceCompleteness";
import {
  lessonProgress,
  summariseStatuses,
  formatSummary,
  type DbStatus,
} from "@/lib/attendanceSummary";
import type { Student, Session, ClassInfo, Guest, Extra } from "@/features/roster/types";

export function toClassInfo(cls: any): ClassInfo {
  return {
    title: cls.title,
    day_of_week: cls.day_of_week,
    start_time: cls.start_time,
    end_time: cls.end_time,
    // PostgREST returns a to-one embed as an object; the generated types widen
    // it to an array, so cast rather than index.
    location_name: (cls.locations as any)?.name ?? "—",
  };
}

export function toActiveStudents(cls: any): Student[] {
  return (cls.student_class_enrolments ?? [])
    .filter((e: any) => e.is_active)
    // NOTE (§7.28): date_of_birth is read off `e.students`, NOT off the
    // enrolment — both tables are in this nested select and the result is
    // `any`, so the wrong nesting level would typecheck and render every
    // child ageless.
    .map((e: any) => ({
      id: e.students.id,
      full_name: e.students.full_name,
      date_of_birth: e.students.date_of_birth,
      // Off the JOINED tenant_levels row (§7.28).
      level_label: e.students.tenant_levels?.label ?? null,
      level_note: e.students.tenant_levels?.note ?? null,
      // Sorted here: PostgREST cannot order an embedded resource, so doing
      // it in the query would silently do nothing.
      level_skills: [...(e.students.tenant_levels?.tenant_level_skills ?? [])]
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((sk: any) => sk.label),
    }));
}

export function toUpcomingExtras(extraData: any[] | null): Extra[] {
  return (extraData ?? []).map((s: any) => ({
    id: s.id as string,
    session_date: s.session_date as string,
    reason: s.off_schedule_reason as string,
  }));
}

// Who was expected at a lesson is a question about THAT LESSON'S date, so
// an enrolment is a span, not a flag. Built from every enrolment row (not
// just the active ones): a child who has since left was still expected at
// the lessons they were enrolled for, and their marked rows must keep
// counting. See EnrolmentSpan in lib/attendanceCompleteness.ts.
export function toEnrolmentSpans(cls: any): EnrolmentSpan[] {
  return (
    cls.student_class_enrolments ?? []
  ).map((e: any) => ({
    studentId: (e.student_id ?? e.students?.id) as string,
    from: toSgDate(e.enrolled_at),
    until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
  }));
}

// The same rows, read the other way: who is coming, and when. `today` is the
// clock the screen reads AFTER the bookings await — passed in, never read here.
export function upcomingBookings(rows: any[] | null, today: string): any[] {
  return (rows ?? [])
    .filter((b: any) => (b.session_date as string) >= today)
    .sort((a: any, b: any) =>
      (a.session_date as string).localeCompare(b.session_date as string)
    );
}

export function guestIdsOf(upcoming: any[], upcomingMk: any[]): string[] {
  return [
    ...new Set([
      ...upcoming.map((b: any) => b.student_id),
      ...upcomingMk.map((b: any) => b.student_id),
    ]),
  ];
}

export function nameByIdOf(guestRows: any[] | null): Map<string, string> {
  return new Map(
    (guestRows ?? []).map((s: any) => [s.id as string, s.full_name as string])
  );
}

export function namedGuests(
  upcoming: any[],
  nameById: Map<string, string>,
  fallback: string
): Guest[] {
  return upcoming.map((b: any) => ({
    id: b.student_id as string,
    full_name: nameById.get(b.student_id as string) ?? fallback,
    session_date: b.session_date as string,
  }));
}

// One merged map: both kinds of booking mean "expected at this lesson",
// which is the contract expectedStudentsOn already has.
export function bookedByDateOf(
  bookingRows: any[] | null,
  makeupBookingRows: any[] | null
): Map<string, string[]> {
  const bookedByDate = new Map<string, string[]>();
  for (const b of [...(bookingRows ?? []), ...(makeupBookingRows ?? [])]) {
    const list = bookedByDate.get(b.session_date as string) ?? [];
    list.push(b.student_id as string);
    bookedByDate.set(b.session_date as string, list);
  }
  return bookedByDate;
}

/**
 * The session list and the Mark Attendance target, in ONE function on
 * purpose: `seen` is derived from the mapped rows, the synthesis loop pushes
 * into the SAME array, and the sort comes last. Splitting it into two
 * functions that return separate arrays is how a date gets pushed twice.
 */
export function buildSessions(args: {
  sessionData: any[] | null;
  enrolmentSpans: EnrolmentSpan[];
  bookedByDate: Map<string, string[]>;
  dayOfWeek: DayOfWeek;
  winStart: string;
  todayDate: string;
}): { rows: Session[]; target: { date: string } | null } {
  const { sessionData, enrolmentSpans, bookedByDate, dayOfWeek, winStart, todayDate } = args;

  const rows: Session[] = (sessionData ?? []).map((s: any) => {
    const markedIds = new Set<string>(
      (s.attendance ?? []).map((a: any) => a.student_id)
    );
    // Enrolled students PLUS anyone booked for a trial that day — the shared
    // rule, so this screen and the engine count the same people. A lesson
    // the admin CANCELLED in advance expects nobody enrolled (the engine's
    // `unmarkedOn` makes the same substitution) — its bookings still count.
    const cancelled = s.cancelled_at != null;
    const expectedHere = cancelled
      ? expectedStudentsOn(s.session_date, [], bookedByDate)
      : expectedStudentsOn(s.session_date, enrolmentSpans, bookedByDate);
    return {
      id: s.id,
      session_date: s.session_date,
      cancelled,
      cancelReason: (s.cancellation_reason as string | null) ?? null,
      // Every past lesson has ended by definition — this list is bounded to
      // `<= todayDate` — so `upcoming` is unreachable here.
      progress: lessonProgress(expectedHere, markedIds, { hasEnded: true }),
      summary: formatSummary(
        summariseStatuses(
          expectedHere,
          new Map<string, DbStatus>(
            (s.attendance ?? []).map((a: any) => [a.student_id, a.status])
          )
        )
      ),
    };
  });

  // Merge in lessons that should have happened but were never marked — those
  // have no session row, so querying lesson_sessions alone renders nothing and
  // the screen would imply the class is fully up to date.
  //
  // The window floor is max(the BUSINESS'S marking floor, earliest enrolment):
  // the coach can mark back to there but no further — older lessons sit behind
  // a generated invoice and need a credit note, not a late mark. The same
  // window bounds the "Mark Attendance" target below.
  //
  // That floor is NOT "the start of last month" any more. Since 20260806000200
  // it follows billing_periods per business, so a month that was never sealed
  // stays markable after the calendar has rolled past it — which is what stops
  // a late-billed month from stranding a lesson nobody may record. A failed
  // fetch returns null and falls back to the old calendar rule.
  let target: { date: string } | null = null;

  // ⚠ NOT GATED ON `activeStudentIds.length > 0` — THAT GATE HID A LESSON
  // THE ENGINE BLOCKS ON. Until 20260810 both the synthesised rows and the
  // Mark Attendance target lived inside `if (activeStudentIds.length > 0)`,
  // so a class with no active enrolment rendered no lessons and no button —
  // even on a date where a trial or make-up guest was booked and expected.
  // The Schedule tab disagreed, listing that same lesson under NEEDS MARKING
  // with a Mark button, because it derives who is expected from
  // `expectedStudentsOn()` rather than from a head-count. Two coach surfaces
  // answering "is there a lesson here?" differently is the §7.18 shape, and
  // the seed's default state (one class, zero enrolments) sat on the wrong
  // side of it.
  //
  // ONE derivation of who was expected, shared with the Schedule tab and the
  // engine: `lessonDatesInRange` unions weekday dates, booking dates and
  // recorded session dates within the window, and `expectedStudentsOn` then
  // decides whether anyone was actually due. Do not re-inline either — §7.18
  // is four hand-written copies of this union causing a live underbill.
  // Built ONCE. `sessionData` has no lower bound (every past session this
  // class has ever held), and the loop below runs over every date in the
  // window, so a `.find()` per date is O(dates x sessions) on every open.
  const sessionIdByDate = new Map<string, string>(
    (sessionData ?? []).map((s: any) => [s.session_date as string, s.id as string])
  );
  // Dates the admin cancelled in advance: nobody enrolled is due, so such a
  // date must neither be synthesised as unmarked nor become the Mark target.
  const cancelledDates = new Set<string>(
    (sessionData ?? [])
      .filter((s: any) => s.cancelled_at != null)
      .map((s: any) => s.session_date as string)
  );
  const sessionDates = [...sessionIdByDate.keys()];
  const seen = new Set(rows.map((r) => r.session_date));

  for (const date of lessonDatesInRange(
    dayOfWeek,
    winStart,
    todayDate,
    bookedByDate.keys(),
    sessionDates
  )) {
    // Nobody due here. This is what suppresses weekday dates from before the
    // class had any enrolments — the job the per-class enrolment floor used
    // to do, moved to where it can distinguish "no students yet" from "a
    // guest is booked". A guest-only date survives it; an empty one does not.
    const expectedHere = cancelledDates.has(date)
      ? expectedStudentsOn(date, [], bookedByDate)
      : expectedStudentsOn(date, enrolmentSpans, bookedByDate);
    if (expectedHere.length === 0) continue;

    // Primary action targets the most recent lesson anyone was due at.
    // `lessonDatesInRange` returns ascending, so the last write wins — and
    // because this now runs over the FILTERED list, the button can no longer
    // point at a weekday date with nobody on it while a guest's real lesson
    // goes untargeted.
    target = { date };

    if (seen.has(date)) continue;
    rows.push({
      id: null,
      session_date: date,
      // Span-derived, like the rows above, rather than the class's CURRENT
      // head-count. A synthesised row used `totalStudents`, so a lesson from
      // before a child joined showed them in its denominator — the §8.15
      // mid-month-joiner mistake, surviving on this one code path.
      progress: lessonProgress(expectedHere, undefined, { hasEnded: true }),
      summary: "",
    });
  }

  // Descending. Sessions outside the expected window are kept — never hide
  // real data; the window only bounds which dates get synthesised.
  rows.sort((a, b) => b.session_date.localeCompare(a.session_date));

  return { rows, target };
}

// Names shared by more than one child on THIS roster — the two-Ethan-Tans
// case. Compared on the same normalised form as the database's identity
// index (trimmed + lowercased) so the screen and the constraint agree on
// what "the same name" means.
export function duplicateNameKeys(students: Student[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const s of students) {
    const key = s.full_name.trim().toLowerCase();
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return dupes;
}
