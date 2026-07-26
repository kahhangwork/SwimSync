/**
 * How the admin panel says "how many students".
 *
 * The counts mean **active** students, because that is the number a business
 * acts on: how many children are actually swimming. A child who has left is
 * still a row — attendance and invoices reference them forever (PRD §7.14) — so
 * a plain `COUNT(*)` answers a bookkeeping question nobody asked and silently
 * drifts upward as families come and go.
 *
 * The inactive figure is shown only when there IS one. A permanent `· 0
 * inactive` is noise on a screen where it will almost always be zero, and the
 * suffix appearing is itself the signal that somebody left.
 *
 * NOT named `formatStudentCount` / `describeStudentCount` — both already exist
 * in `lib/classRoster.ts` for the class roster's `2+1` badge, which counts
 * enrolments-plus-trials in one class. Different question, different answer.
 */

/**
 * The Students page header.
 *
 *     (15, 0) → "15 active students"
 *     (14, 1) → "14 active students · 1 inactive"
 */
export function formatActiveStudents(active: number, inactive: number): string {
  const noun = active === 1 ? "student" : "students";
  return `${active} active ${noun}${inactiveNote(inactive)}`;
}

/**
 * The suffix on its own, for callers that compose it onto their own text — the
 * Dashboard card appends it to "Across all coaches" rather than replacing it,
 * because "across all coaches" is real information (the count is business-wide,
 * not per-coach) and would otherwise be lost to make room.
 *
 * Returns "" at zero, so the caller needs no conditional.
 */
export function inactiveNote(inactive: number): string {
  return inactive > 0 ? ` · ${inactive} inactive` : "";
}

/**
 * The level-removal warning — and it counts **everyone**, not just the active.
 *
 * `students.level_id` is `ON DELETE SET NULL`
 * (`20260719001800_tenant_levels.sql`), so removing a level cannot fail: it
 * blanks the level for every student pointing at it, active or not. Answering
 * "who does this affect?" with the ACTIVE count would tell an admin "No students
 * are on this level" about a level still held by children who have left — they
 * delete it, those children lose a level, and nothing anywhere records what it
 * was. Reactivate one later and it cannot be restored.
 *
 * So the column and this sentence deliberately read two different numbers. The
 * column answers a roster question; this answers a data question, and the
 * database constraint does not filter by `is_active`.
 */
export function describeLevelRemoval(active: number, inactive: number): string {
  const total = active + inactive;
  if (total === 0) return "No students are on this level.";

  const tail =
    " will simply have no level. Nobody is removed from a class, and no history changes.";

  // Only inactive children hold this level — say "inactive" explicitly, because
  // the column beside this modal reads 0 and the admin needs to know why these
  // two numbers disagree.
  if (active === 0) {
    return `${inactive} inactive student${inactive === 1 ? "" : "s"}${tail}`;
  }

  if (inactive === 0) {
    return `${active} student${active === 1 ? "" : "s"}${tail}`;
  }

  return `${total} students (${inactive} of them inactive)${tail}`;
}
