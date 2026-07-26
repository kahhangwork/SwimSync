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
import { type EnrolmentSpan, unmarkedDates } from "./attendanceCompleteness";

export type CoverageClass = {
  id: string;
  title: string;
  day_of_week: string;
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

    const expected = expectedLessonDates(cls.day_of_week as DayOfWeek, from, to);
    if (expected.length === 0) continue;

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

    // Booking dates join the expected list: a trial on a date with no session
    // yet would otherwise be invisible here while the engine blocks on it.
    const expectedWithTrials = [
      ...new Set([...expected, ...bookedByDate.keys()]),
    ].sort();

    const missingDates = unmarkedDates(
      expectedWithTrials,
      markedByDate,
      enrolmentSpans,
      bookedByDate
    );

    coverage.push({
      classId: cls.id,
      title: cls.title,
      expected: expectedWithTrials.length,
      marked: expectedWithTrials.length - missingDates.length,
      missingDates,
    });
  }

  return coverage;
}
