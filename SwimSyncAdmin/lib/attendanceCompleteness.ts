// The completeness rule — one definition, used everywhere it is asked.
//
// THE RULE: a lesson counts as marked only when its session exists AND every
// student ENROLLED ON THAT DATE has an attendance row on it. A lesson with no
// session row at all is UNMARKED, not absent — lesson_sessions rows are created
// lazily by attendance marking (PRD §7.5), so "no row" is exactly what a
// forgotten lesson looks like.
//
// This rule decides whether invoices may be generated (PRD §7.7), so the four
// places that ask it must agree. They used to be four hand-written copies, and
// they had already diverged: the engine checked only sessions that EXIST, so a
// lesson nobody touched was invisible to it and the month could seal with that
// lesson permanently unbilled. The admin's pre-flight check derived expected
// dates and caught it — meaning the only effective gate was client-side.
//
// ── ENROLMENT IS A SPAN, NOT A FLAG ─────────────────────────────────────────
// This file used to take a flat list of ACTIVELY-enrolled student ids and
// expect every one of them at every lesson in the caller's window. That is
// wrong for anyone whose enrolment does not cover the whole window, and it was
// a live billing blocker:
//
//   A child enrolled on 20 June was expected at the 6 June and 13 June lessons
//   too. They have no rows there, so the month reported incomplete_attendance —
//   and unmarked attendance blocks generation entirely, with no override (§8a).
//   Clearing it meant marking a child at a lesson they were not enrolled for.
//
// The engine's window floor is the CLASS's earliest enrolment, which protects a
// brand-new class and does nothing for a later joiner into an established one.
// So the question "who was expected here?" is answered per DATE, from the span
// each enrolment actually covers. `is_active` cannot answer it: it describes
// today, and a past lesson is not today.
//
// The span is inclusive at BOTH ends. That is load-bearing for the trial
// walk-in, whose enrolment opens and closes on its own date — with an exclusive
// end they would be expected at no lesson at all.
//
// DATES ARE PLAIN "YYYY-MM-DD" STRINGS, compared lexically (which is
// chronological for that format). Callers convert their own timestamps —
// enrolled_at and unenrolled_at are TIMESTAMPTZ — using toSgDate() from
// lessonDates.ts. That conversion deliberately does NOT happen here: this file
// has ZERO imports so drift between its copies is cheap to spot, and pulling in
// a date library would end that.
//
// DUPLICATED BYTE-IDENTICAL in SwimSyncAdmin/lib/attendanceCompleteness.ts, the
// same deliberate arrangement as lessonDates.ts: separate npm projects, no
// workspace, different bundlers. The billing engine keeps its own Deno copy in
// supabase/functions/generate-invoices/ (no npm resolution in Edge Functions) —
// that one is unavoidable, so make it THREE edits, not two. A test in
// SwimSyncAdmin reads all three off disk and fails if they diverge, so this is
// enforced rather than remembered.
//
// Callers still own their own WINDOW (a billing month for billing, a rolling
// backlog window for the coach) — that part legitimately differs. What must not
// differ is what "marked" means, which is all this file defines.

/** Attendance presence keyed by session: which students have a row. */
export type MarkedBySession = Map<string, Set<string>>;

/**
 * One enrolment, as a date span.
 *
 * `from` is the day the enrolment opened; `until` the day it closed, or null
 * while it is open. Both are "YYYY-MM-DD" and both ends are INCLUSIVE.
 */
export type EnrolmentSpan = {
  studentId: string;
  from: string;
  until: string | null;
};

/**
 * Who was enrolled in this class on `date`.
 *
 * Deduped: a child can hold more than one enrolment row over time (unenrol then
 * re-enrol keeps history, PRD §11.5), and both may match a given date at the
 * edges.
 */
export function studentsEnrolledOn(
  date: string,
  enrolments: readonly EnrolmentSpan[]
): string[] {
  const ids = enrolments
    .filter((e) => e.from <= date && (e.until === null || date <= e.until))
    .map((e) => e.studentId);
  return [...new Set(ids)];
}

/**
 * Is this lesson fully marked? True only when the session exists and every
 * expected student has a row on it.
 *
 * `markedStudentIds` undefined means there is no session at all — which is
 * unmarked unless nobody was expected.
 */
export function isLessonFullyMarked(
  expectedStudentIds: readonly string[],
  markedStudentIds: Set<string> | undefined
): boolean {
  if (!markedStudentIds) return expectedStudentIds.length === 0;
  return expectedStudentIds.every((id) => markedStudentIds.has(id));
}

/**
 * How many expected students are marked on this lesson. Counts only students
 * expected on that date — a row for someone who had already left does not make
 * the lesson more marked.
 */
export function countMarked(
  expectedStudentIds: readonly string[],
  markedStudentIds: Set<string> | undefined
): number {
  if (!markedStudentIds) return 0;
  return expectedStudentIds.filter((id) => markedStudentIds.has(id)).length;
}

/** Expected students with no attendance row on this lesson. */
export function unmarkedStudents(
  expectedStudentIds: readonly string[],
  markedStudentIds: Set<string> | undefined
): string[] {
  if (!markedStudentIds) return [...expectedStudentIds];
  return expectedStudentIds.filter((id) => !markedStudentIds.has(id));
}

/**
 * Which of `expectedDates` are not fully marked, ascending.
 *
 * Pass every date the class should have run in the caller's window; dates with
 * no session are reported, which is the entire point — that is what a forgotten
 * lesson looks like.
 */
export function unmarkedDates(
  expectedDates: readonly string[],
  markedBySessionDate: Map<string, Set<string>>,
  enrolments: readonly EnrolmentSpan[],
  /** Trial bookings by date. Omit when the caller has none to consider. */
  bookedByDate: Map<string, readonly string[]> = new Map()
): string[] {
  // Nobody ever enrolled AND nobody booked means nothing to mark. Checking only
  // enrolments here would hide a class whose sole attendee this month is a
  // trial — and an unmarked trial is exactly what must be surfaced.
  if (enrolments.length === 0 && bookedByDate.size === 0) return [];
  return expectedDates
    .filter((date) => {
      const expected = expectedStudentsOn(date, enrolments, bookedByDate);
      return (
        expected.length > 0 &&
        !isLessonFullyMarked(expected, markedBySessionDate.get(date))
      );
    })
    .sort();
}

/**
 * Who is expected at this class ON THIS DATE.
 *
 * Students whose enrolment covers the date, plus anyone booked for a TRIAL that
 * day.
 *
 * WHY THIS IS A DATE-SCOPED QUESTION. It used to be one set for a whole month:
 * everyone actively enrolled was expected at every lesson. Two things break
 * that. A trial booking is expected at exactly ONE lesson and at no other, so
 * the month-wide answer would expect a trial child every week. And an enrolment
 * that starts or ends mid-window covers only part of it — the joiner case
 * above, which blocked whole months from billing.
 *
 * WHY IT LIVES HERE. This file is the ONE definition of "marked", and the same
 * union is needed by the billing engine, the admin's pre-flight check, the
 * coach's Unmarked Lessons list and the class roster. Those four diverged once
 * before and the client became the only effective gate — a live underbill
 * (§7.18). Four hand-written unions would be that again, so there is one,
 * copied with the rest of this file.
 *
 * DO NOT inline `[...enrolled, ...booked]` at a call site.
 *
 * Deduped, because a child can legitimately appear in both: a trial booking
 * that was later enrolled without the booking being cancelled.
 */
export function expectedStudentsOn(
  date: string,
  enrolments: readonly EnrolmentSpan[],
  bookedByDate: Map<string, readonly string[]>
): string[] {
  const enrolled = studentsEnrolledOn(date, enrolments);
  const booked = bookedByDate.get(date);
  if (!booked || booked.length === 0) return enrolled;
  return [...new Set([...enrolled, ...booked])];
}
