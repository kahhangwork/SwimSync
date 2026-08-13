// Expected-vs-marked lesson coverage for a billing month.
//
// The invoice engine bills exactly what attendance says, and a lesson nobody
// marked is indistinguishable from a lesson that never happened. This derives
// the lessons that SHOULD have been marked from each class's weekly schedule,
// so the admin can see gaps before generating invoices.
//
// Pure — no Supabase, no React. The caller fetches the four row sets.

import {
  expectedLessonDates,
  monthBounds,
  toSgDate,
  type DayOfWeek,
} from "./lessonDates";
import {
  type EnrolmentSpan,
  expectedStudentsOn,
  unmarkedDates,
} from "./attendanceCompleteness";

export type CoverageClass = {
  id: string;
  title: string;
  day_of_week: string;
  /**
   * Both optional, and absent means ACTIVE — the engine bills every class
   * regardless of status, so the pre-flight must see them all too. A caller
   * that has not been updated to fetch these still behaves exactly as it did
   * before the inactive-class fix.
   */
  is_active?: boolean;
  /** DATE, not a boolean — see the clamp below and §7.109. */
  deactivated_at?: string | null;
};

export type CoverageEnrolment = {
  class_id: string;
  student_id: string;
  is_active: boolean;
  enrolled_at: string;
  /** null while the enrolment is open. Both ends are inclusive — see
   *  EnrolmentSpan in attendanceCompleteness.ts. */
  unenrolled_at: string | null;
};

export type CoverageSession = {
  id: string;
  class_id: string;
  session_date: string;
};

export type CoverageAttendance = {
  lesson_session_id: string;
  student_id: string;
};

/** A child booked for a TRIAL — expected at ONE lesson, not enrolled. */
export type CoverageBooking = {
  class_id: string;
  student_id: string;
  session_date: string;
};

export type ClassCoverage = {
  classId: string;
  title: string;
  expected: number;
  marked: number;
  missingDates: string[];
};

/**
 * Per-class coverage for `billingMonth`, ordered as `classes` was.
 *
 * A lesson counts as marked only when its session exists AND every actively
 * enrolled student has an attendance row on it — the same rule the engine's
 * completeness gate uses (generate-invoices/core.ts) and the same one the coach
 * app shows, so all three tell one story.
 *
 * Classes with no active enrolments are omitted: there is nothing to mark and
 * nothing to bill, and reporting them as gaps would be noise.
 */
export function computeClassCoverage(
  classes: CoverageClass[],
  enrolments: CoverageEnrolment[],
  sessions: CoverageSession[],
  attendance: CoverageAttendance[],
  billingMonth: string,
  today: string,
  /** Live trial bookings in the month. Omitted by callers that have none. */
  bookings: CoverageBooking[] = []
): ClassCoverage[] {
  const bounds = monthBounds(billingMonth);
  if (!bounds.start) return [];

  // Marked students per SESSION, built once. Scanning `attendance` per session
  // per class instead would be O(classes × sessions × attendance) on the
  // admin's pre-flight check, which runs on every invoice-dialog open.
  const markedBySession = new Map<string, Set<string>>();
  for (const a of attendance) {
    const set = markedBySession.get(a.lesson_session_id) ?? new Set<string>();
    set.add(a.student_id);
    markedBySession.set(a.lesson_session_id, set);
  }

  const coverage: ClassCoverage[] = [];

  for (const cls of classes) {
    const classEnrolments = enrolments.filter((e) => e.class_id === cls.id);
    const activeStudentIds = classEnrolments
      .filter((e) => e.is_active)
      .map((e) => e.student_id);

    // WHO MUST BE MARKED is a question about the LESSON'S DATE, not about who
    // is enrolled today: a child who joined on the 20th was never expected at
    // the lesson on the 6th. Reporting that as a gap blocked the whole month
    // (§8a — no override), and the only way to clear it was to mark them at a
    // lesson they were not enrolled for.
    const enrolmentSpans: EnrolmentSpan[] = classEnrolments.map((e) => ({
      studentId: e.student_id,
      from: toSgDate(e.enrolled_at),
      until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
    }));

    // Bookings for THIS class, by date. A trial is expected at one lesson, so
    // this is per-date rather than a single set for the month.
    const bookedByDate = new Map<string, string[]>();
    for (const b of bookings) {
      if (b.class_id !== cls.id) continue;
      const list = bookedByDate.get(b.session_date) ?? [];
      list.push(b.student_id);
      bookedByDate.set(b.session_date, list);
    }

    // Nothing enrolled AND nothing booked means nothing to mark or bill.
    // Checking enrolments alone would skip a class whose only attendee this
    // month is a trial — and an unmarked trial is what holds the month open.
    if (activeStudentIds.length === 0 && bookedByDate.size === 0) continue;

    // Bound by the earliest enrolment across ALL enrolments, active or not — an
    // active-only bound would let a fully-unenrolled class hide lessons it ran.
    const enrolmentDates = classEnrolments.map((e) => toSgDate(e.enrolled_at));
    const earliest = enrolmentDates.sort()[0];

    const from = earliest > bounds.start ? earliest : bounds.start;
    // Clamp to today so future lessons in the current month aren't "missing".
    const to = today < bounds.end ? today : bounds.end;

    // ── Pattern dates, clamped at the day the class stopped being SCHEDULABLE ──
    // Mirrors the engine's lastScheduledDate/expectedTo (core.ts §"...and
    // clamped at the day the class stopped being SCHEDULABLE"), because this
    // check now sees INACTIVE classes at all. Three cases, and the third is why
    // `deactivated_at` is a DATE and a boolean cannot replace it (§7.109):
    //   active                     → schedulable to the end of the window
    //   deactivated on a date      → schedulable up to that date, not past it
    //   inactive, no date recorded → predates deactivate_class(); nothing is
    //                                known, so it expects nothing.
    const lastScheduled: string | null =
      cls.is_active !== false
        ? to
        : cls.deactivated_at
        ? toSgDate(cls.deactivated_at)
        : null;

    const expectedTo =
      lastScheduled === null || lastScheduled < from
        ? null
        : lastScheduled < to
        ? lastScheduled
        : to;

    const patternDates =
      expectedTo === null
        ? []
        : expectedLessonDates(cls.day_of_week as DayOfWeek, from, expectedTo);

    // ── Lessons that ACTUALLY EXIST, whatever weekday they fell on ────────────
    // The half this check was missing, and the reason it could report a month
    // complete that the engine then refused to bill. `schedule_extra_lesson()`
    // waives the weekday rule deliberately, so an off-pattern extra appears in
    // NO weekly series and was invisible here while blocking the engine, which
    // has always unioned `sessionByDate.keys()` (core.ts). §7.18 is the standing
    // reason these two must not drift: hand-written copies of "who was expected
    // here" caused a live underbill.
    //
    // ⚠ CLAMPED TO `to`, AND THE EQUIVALENCE IS WHAT MAKES THAT SAFE. For any
    // ENDED month — the only kind the engine can bill — `to` IS `bounds.end`,
    // so this filter removes nothing and the two agree exactly; the test
    // "clamping session dates is a no-op on an ended month" pins it. What it
    // does remove is a FUTURE session in the CURRENT month: `assign_session_coach()`
    // creates a lesson_sessions row when an admin arranges cover in advance
    // (sessionRoster.ts), and reporting that as a gap invites someone to mark
    // attendance for a lesson that has not happened yet. The pattern half has
    // clamped for that reason since it was written.
    const sessionDates = sessions
      .filter((s) => s.class_id === cls.id)
      .map((s) => s.session_date)
      // Re-bounded rather than trusted, so a caller whose query forgot its
      // range cannot smear another month into this one.
      .filter((d) => d >= bounds.start && d <= to);

    // ⚠ THE UNION HAPPENS BEFORE THE EMPTY GUARD, not after. Guarding on the
    // pattern dates alone skipped a class whose ONLY lesson that month was an
    // off-pattern extra — the same bug one level up, and the more complete
    // failure: not a missing date, an entire missing class.
    const expectedDates = [
      ...new Set([...patternDates, ...sessionDates, ...bookedByDate.keys()]),
    ].sort();
    if (expectedDates.length === 0) continue;

    // Marked students per lesson DATE — the shape the shared completeness rule
    // takes. A date absent from this map has no session at all, which the rule
    // treats as unmarked (that is what a forgotten lesson looks like).
    //
    // EVERYONE WITH A ROW, not a filtered subset. This used to intersect with
    // the currently-active students, which was safe only while "expected" was
    // that same set. Now that expectation is date-scoped, a child who was
    // enrolled on the lesson's date but has since LEFT is legitimately expected
    // there — and filtering them out of the marked set would report their
    // already-recorded attendance as a gap, blocking the month over a lesson
    // that was marked correctly months ago.
    const markedByDate = new Map<string, Set<string>>(
      sessions
        .filter((s) => s.class_id === cls.id)
        .map((s) => [
          s.session_date,
          markedBySession.get(s.id) ?? new Set<string>(),
        ])
    );

    const missingDates = unmarkedDates(
      expectedDates,
      markedByDate,
      enrolmentSpans,
      bookedByDate
    );

    // ⚠ COUNTED SEPARATELY FROM WHAT IS CHECKED, and the difference is the
    // point. `expectedDates` is deliberately wide — it holds every date that
    // could possibly need a mark, so nothing escapes `unmarkedDates`. But some
    // of those dates had NOBODY expected on them: a session that ran before the
    // only enrolment opened, or a pattern date in a guest-only class. Those are
    // filtered out of `missingDates` by the rule itself (expected.length > 0),
    // so counting them would increment BOTH numbers and render "8 of 8" where
    // the truth is "4 of 4". This dialog's whole job is to be believed, so the
    // count is over the dates a mark was actually owed on.
    //
    // Order matters: missingDates ⊆ countedDates by construction, because
    // unmarkedDates applies the same non-empty test. `marked` cannot go negative.
    const countedDates = expectedDates.filter(
      (d) => expectedStudentsOn(d, enrolmentSpans, bookedByDate).length > 0
    );

    coverage.push({
      classId: cls.id,
      title: cls.title,
      expected: countedDates.length,
      marked: countedDates.length - missingDates.length,
      missingDates,
    });
  }

  return coverage;
}
