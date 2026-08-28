/**
 * The admin's grade-scale editor, and the friendly face of the database's
 * keep-records guard.
 *
 * Skills grading (Wave C Piece 4) stores a child's earned grades in
 * `student_skill_progress`, whose FKs onto a skill and onto a grade level are
 * `ON DELETE RESTRICT`. So the database REFUSES (Postgres 23503) to delete a
 * grade level, a skill, or — by cascade — a level that any child has been
 * graded against. That refusal is the keep-records decision made structural:
 * it is not a bug to route around, it is the feature. This module turns the
 * bare 23503 into a sentence a business owner understands, and computes the
 * rank a newly added grade should take.
 *
 * Pure and framework-free so it is unit-tested (lib/skillScale.test.ts) rather
 * than only exercised through the page.
 */

export type GradeLevel = { id: string; rank: number; label: string };

/** The rank a newly added grade takes: one past the current top (1 if empty). */
export function nextRank(scale: { rank: number }[]): number {
  return scale.reduce((hi, g) => Math.max(hi, g.rank), 0) + 1;
}

export type DeletableKind = "grade" | "skill" | "level";

/**
 * A message for a failed delete. When the database refused because a child's
 * record depends on the row (FK violation, 23503), say WHY and that nothing was
 * lost — deleting is not the way to tidy a curriculum a child has been graded
 * against. Any other error is a generic failure.
 */
export function describeDeleteError(
  err: { code?: string } | null | undefined,
  kind: DeletableKind
): string {
  if (err?.code === "23503") {
    switch (kind) {
      case "grade":
        return "A child has been graded at this level, so it can't be removed. Rename it instead — their records are kept.";
      case "skill":
        return "A child has been graded on this skill, so it can't be removed. Their records are kept.";
      case "level":
        return "A child has been graded on one of this level's skills, so it can't be removed. Their records are kept.";
    }
  }
  return `Could not remove that ${kind}. Please try again.`;
}
