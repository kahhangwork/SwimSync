// The completeness rule — one definition, used everywhere it is asked.
//
// THE RULE: a lesson counts as marked only when its session exists AND every
// actively-enrolled student has an attendance row on it. A lesson with no
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
// Callers still own their own WINDOW (a billing month for billing, a rolling
// backlog window for the coach) — that part legitimately differs. What must not
// differ is what "marked" means, which is all this file defines.
//
// DUPLICATED BYTE-IDENTICAL in SwimSyncApp/lib/attendanceCompleteness.ts, the
// same deliberate arrangement as lessonDates.ts: separate npm projects, no
// workspace, different bundlers. The file has zero imports so drift is cheap to
// spot (`diff` the two). EDIT BOTH. The billing engine keeps its own Deno copy
// in supabase/functions/generate-invoices/ (no npm resolution in Edge
// Functions) — that one is unavoidable, so make it three edits, not two.

/** Attendance presence keyed by session: which students have a row. */
export type MarkedBySession = Map<string, Set<string>>;

/**
 * Is this lesson fully marked? True only when the session exists and every
 * active student has a row on it.
 *
 * `markedStudentIds` undefined means there is no session at all — which is
 * unmarked unless nobody is enrolled to mark.
 */
export function isLessonFullyMarked(
  activeStudentIds: readonly string[],
  markedStudentIds: Set<string> | undefined
): boolean {
  if (!markedStudentIds) return activeStudentIds.length === 0;
  return activeStudentIds.every((id) => markedStudentIds.has(id));
}

/**
 * How many active students are marked on this lesson. Counts only students
 * still enrolled — a departed student's row does not make a lesson more marked.
 */
export function countMarked(
  activeStudentIds: readonly string[],
  markedStudentIds: Set<string> | undefined
): number {
  if (!markedStudentIds) return 0;
  return activeStudentIds.filter((id) => markedStudentIds.has(id)).length;
}

/** Active students with no attendance row on this lesson. */
export function unmarkedStudents(
  activeStudentIds: readonly string[],
  markedStudentIds: Set<string> | undefined
): string[] {
  if (!markedStudentIds) return [...activeStudentIds];
  return activeStudentIds.filter((id) => !markedStudentIds.has(id));
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
  activeStudentIds: readonly string[]
): string[] {
  if (activeStudentIds.length === 0) return [];
  return expectedDates
    .filter(
      (date) => !isLessonFullyMarked(activeStudentIds, markedBySessionDate.get(date))
    )
    .sort();
}
