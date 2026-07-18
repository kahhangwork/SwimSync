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
import { unmarkedDates } from "./attendanceCompleteness";

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
  today: string
): ClassCoverage[] {
  const bounds = monthBounds(billingMonth);
  if (!bounds.start) return [];

  const attendanceKeys = new Set(
    attendance.map((a) => `${a.lesson_session_id}:${a.student_id}`)
  );

  const coverage: ClassCoverage[] = [];

  for (const cls of classes) {
    const classEnrolments = enrolments.filter((e) => e.class_id === cls.id);
    const activeStudentIds = classEnrolments
      .filter((e) => e.is_active)
      .map((e) => e.student_id);

    if (activeStudentIds.length === 0) continue;

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
    const markedByDate = new Map<string, Set<string>>(
      sessions
        .filter((s) => s.class_id === cls.id)
        .map((s) => [
          s.session_date,
          new Set(
            activeStudentIds.filter((studentId) =>
              attendanceKeys.has(`${s.id}:${studentId}`)
            )
          ),
        ])
    );

    const missingDates = unmarkedDates(expected, markedByDate, activeStudentIds);

    coverage.push({
      classId: cls.id,
      title: cls.title,
      expected: expected.length,
      marked: expected.length - missingDates.length,
      missingDates,
    });
  }

  return coverage;
}
