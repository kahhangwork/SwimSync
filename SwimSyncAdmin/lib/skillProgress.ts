// Pure helpers for per-child swim-skill grading (Wave C S-pool Piece 4).
//
// The SCREENS stay thin; everything that can be reasoned about without a
// network or a renderer lives here, because jest only runs `lib/**` (see
// jest.config.js). Two jobs:
//   • summariseSkillProgress — read side, shared by the coach roster and the
//     parent child view: pair each skill with its grade and compute
//     "n of m at <top grade>".
//   • cycleGrade — write side, the coach's tap-to-cycle: ungraded → lowest
//     rank → … → top rank → ungraded again.
//
// "DONE" IS THE TOP RANK, COMPUTED, NEVER STORED (mirrors the migration): a
// skill is done when its grade holds the highest rank in the tenant's scale, so
// adding a higher grade re-opens every skill that was done at the old top. Never
// persist a boolean; derive it here every render.

export type GradeLevel = { id: string; rank: number; label: string };

/** A skill of the child's current level. */
export type LevelSkill = { id: string; label: string; sort_order: number };

/** One graded row, as read from student_skill_progress. */
export type ProgressRow = { skill_id: string; grade_level_id: string };

export type SkillWithGrade = {
  id: string;
  label: string;
  /** The grade held, or null when the skill has not been graded yet. */
  grade: GradeLevel | null;
  /** True only when `grade` holds the top rank of the scale. */
  done: boolean;
};

export type SkillSummary = {
  /** Skills in teaching order, each paired with its grade (or null). */
  skills: SkillWithGrade[];
  /** How many skills are at the top grade. */
  doneCount: number;
  /** How many skills the level has. */
  total: number;
  /** Label of the top-rank grade, or null when the scale is empty. */
  topGradeLabel: string | null;
};

/** The top-ranked grade in the scale, or null if the scale is empty. */
export function topGrade(scale: GradeLevel[]): GradeLevel | null {
  if (scale.length === 0) return null;
  return scale.reduce((hi, g) => (g.rank > hi.rank ? g : hi));
}

/**
 * Pair each level skill with its grade and count how many are "done".
 *
 * Defensive by construction (the jest suite's house style): a progress row for
 * a skill not on the current level is ignored, a grade id the scale no longer
 * contains reads as ungraded, and an empty scale yields a null top label with
 * every skill not-done — none of which should throw a screen.
 */
export function summariseSkillProgress(
  skills: LevelSkill[],
  progress: ProgressRow[],
  scale: GradeLevel[]
): SkillSummary {
  const gradeById = new Map(scale.map((g) => [g.id, g]));
  const gradeBySkill = new Map(progress.map((p) => [p.skill_id, p.grade_level_id]));
  const top = topGrade(scale);

  const ordered = [...skills].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)
  );

  const withGrades: SkillWithGrade[] = ordered.map((s) => {
    const gradeId = gradeBySkill.get(s.id);
    const grade = gradeId ? gradeById.get(gradeId) ?? null : null;
    return {
      id: s.id,
      label: s.label,
      grade,
      done: grade != null && top != null && grade.rank === top.rank,
    };
  });

  return {
    skills: withGrades,
    doneCount: withGrades.filter((s) => s.done).length,
    total: withGrades.length,
    topGradeLabel: top?.label ?? null,
  };
}

/**
 * The next grade in the coach's tap cycle. Ordered by rank; wraps past the top
 * back to ungraded (null), so a mistaken tap is always recoverable by tapping
 * on round. An empty scale cannot be cycled and stays null.
 */
export function cycleGrade(
  current: GradeLevel | null,
  scale: GradeLevel[]
): GradeLevel | null {
  if (scale.length === 0) return null;
  const ranked = [...scale].sort((a, b) => a.rank - b.rank);
  if (current == null) return ranked[0];
  const idx = ranked.findIndex((g) => g.id === current.id);
  // A grade no longer in the scale (renamed/removed under the coach) restarts
  // the cycle rather than sticking.
  if (idx === -1) return ranked[0];
  return idx === ranked.length - 1 ? null : ranked[idx + 1];
}
