// The disable-coach dialog's ⚠ RISK 8 list (WAVE_5_PLAN.md chunk 2).
//
// A PAST or TODAY lesson carrying a substitute override that names the coach
// being disabled stays markable only by an ADMIN afterwards: the disabled
// coach no longer resolves as a coach, and the override means the class's own
// coach was never main on it. An unmarked such lesson blocks the tenant's
// whole invoice run with no override (PRD §7.7), so the dialog names those
// lessons up front — "marking these falls to you (admin) after disabling".
//
// FUTURE override rows are not this file's business: disable_coach() deletes
// them, so nothing falls to anyone.
//
// Pure — no Supabase, no React (classCoverage.ts's arrangement). "Marked" is
// the shared completeness rule from attendanceCompleteness.ts, NOT a local
// re-derivation: four hand-written copies of that rule diverged once before
// and it cost a live underbill (§7.18).

import { toSgDate } from "./lessonDates";
import {
  type EnrolmentSpan,
  expectedStudentsOn,
  unmarkedStudents,
} from "./attendanceCompleteness";
import type {
  CoverageEnrolment,
  CoverageAttendance,
  CoverageBooking,
} from "./classCoverage";

/** A lesson whose session_coaches override names the coach being disabled. */
export type OverrideSession = {
  id: string;
  class_id: string;
  /** The class's title, for display. */
  title: string;
  session_date: string;
};

export type UnmarkedOverrideLesson = {
  sessionId: string;
  title: string;
  sessionDate: string;
  /** Expected students with no attendance row yet. */
  unmarkedCount: number;
};

/**
 * Which of the coach's override lessons up to `today` are not fully marked,
 * ascending by date.
 *
 * `bookings` must carry trial AND make-up bookings for the sessions' classes:
 * a booked guest is expected at exactly that lesson, and omitting them here
 * while the engine expects them is the §7.18 divergence again.
 */
export function unmarkedOverrideLessons(
  sessions: readonly OverrideSession[],
  enrolments: readonly CoverageEnrolment[],
  attendance: readonly CoverageAttendance[],
  bookings: readonly CoverageBooking[],
  today: string
): UnmarkedOverrideLesson[] {
  const markedBySession = new Map<string, Set<string>>();
  for (const a of attendance) {
    const set = markedBySession.get(a.lesson_session_id) ?? new Set<string>();
    set.add(a.student_id);
    markedBySession.set(a.lesson_session_id, set);
  }

  const result: UnmarkedOverrideLesson[] = [];

  for (const s of sessions) {
    // Future lessons are the RPC's business (their overrides are deleted),
    // not the admin's marking backlog.
    if (s.session_date > today) continue;

    const spans: EnrolmentSpan[] = enrolments
      .filter((e) => e.class_id === s.class_id)
      .map((e) => ({
        studentId: e.student_id,
        from: toSgDate(e.enrolled_at),
        until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
      }));

    const bookedByDate = new Map<string, string[]>();
    for (const b of bookings) {
      if (b.class_id !== s.class_id) continue;
      const list = bookedByDate.get(b.session_date) ?? [];
      list.push(b.student_id);
      bookedByDate.set(b.session_date, list);
    }

    const expected = expectedStudentsOn(s.session_date, spans, bookedByDate);
    const missing = unmarkedStudents(expected, markedBySession.get(s.id));
    if (missing.length > 0) {
      result.push({
        sessionId: s.id,
        title: s.title,
        sessionDate: s.session_date,
        unmarkedCount: missing.length,
      });
    }
  }

  return result.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}
