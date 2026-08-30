// The Assessment tab's pure core: grouping a class's roster by level, deciding
// what counts as assessed THIS ROUND, and deciding when a child may move up.
//
// Everything here is framework-free and network-free so it is unit-tested
// directly (assessment.test.ts) rather than only through the page. The screens
// stay thin shells: fetch, call these, render.
//
// ── WHY A "ROUND" EXISTS AT ALL ──────────────────────────────────────────────
// Assessment is a periodic EVENT: every few months an admin tours every class.
// The grid shows each skill's CURRENT grade, so a child graded "Competent" in
// June looks exactly like one graded "Competent" this morning — and the
// assessor, seeing a full row, skips them. That is the failure this whole tab
// exists to prevent.
//
// The answer is `graded_at`, which the database stamps server-side on every
// write that is not a merge repoint (20260829000100). Anything older than the
// round's start reads as stale. There is deliberately no stored "round" entity:
// the date the assessor sets IS the round.
//
// ── THE TRAP THIS MODULE IS MOSTLY WRITTEN AROUND ────────────────────────────
// "Assessed" as `freshCount === total` is VACUOUSLY TRUE when total is 0 — a
// child with no level, or a level with no skills. That would report "done" for
// exactly the children nobody can grade, inside the tool built to stop children
// being skipped. Every function below that could return a vacuous yes returns a
// distinguishable NO instead, and the tests pin it.

/** A grade in the tenant's scale. Mirrors skillProgress.ts' GradeLevel. */
export type GradeLevel = { id: string; rank: number; label: string };

/** A skill of some level. */
export type Skill = { id: string; label: string; sort_order: number };

/** A level, with the skills it teaches. */
export type Level = {
  id: string;
  label: string;
  sort_order: number;
  skills: Skill[];
};

/** One graded row, as read from student_skill_progress. */
export type Progress = {
  skill_id: string;
  grade_level_id: string;
  /** ISO timestamp. The round mechanism reads this and nothing else. */
  graded_at: string;
};

/** A child on the class roster. */
export type RosterStudent = {
  id: string;
  full_name: string;
  level_id: string | null;
  progress: Progress[];
};

/** One skill of one child, as the grid renders it. */
export type Cell = {
  skill: Skill;
  grade: GradeLevel | null;
  /** The grade holds the TOP rank of the scale. */
  done: boolean;
  /** Graded at or after the round's start — i.e. looked at this round. */
  fresh: boolean;
  /** When it was last graded, for the stale cell's label. Null if never. */
  gradedAt: string | null;
};

export type StudentRow = {
  student: RosterStudent;
  cells: Cell[];
  /** How many of this level's skills were graded THIS round. */
  freshCount: number;
  /** How many skills the child's level has. Zero means nothing to grade. */
  total: number;
  /**
   * The child has no level, or a level with no skills — so there is literally
   * nothing to assess. Rendered as its own state; NEVER folded into "done".
   */
  noSkills: boolean;
  /** Every skill of the level was graded this round. False when noSkills. */
  assessedThisRound: boolean;
  /**
   * The child was moved up during this round — they have a fresh grade on some
   * OTHER level's skill. Without this they would land in a new sub-table with
   * no fresh grades and read as "not assessed" on the very day they were.
   */
  promotedThisRound: boolean;
};

export type LevelGroup = {
  /** Null for the "No level set" bucket. */
  level: Level | null;
  rows: StudentRow[];
};

/**
 * Is this grade from the current round? A missing timestamp is never fresh.
 *
 * ⚠ THE BOUNDARY IS SINGAPORE MIDNIGHT, AND THE SUFFIX IS LOAD-BEARING.
 * `since` is a Singapore calendar date — `todayInSg()`, or the date the assessor
 * typed into "Assessing since". `gradedAt` is a timestamptz stamped by the
 * server. A ZONELESS `${since}T00:00:00` means "midnight wherever this browser
 * is", which west of Singapore lands LATER than the SGT day it names: grades
 * made in the first hours of the Singapore day then read as a previous round's,
 * and the assessor is told to re-grade children they just graded.
 *
 * That reddened the nightly sweep on 2026-08-29 (UTC runner, 22:42Z = 06:42 the
 * next morning SGT). It is §7.7's axis — a date derived in SGT compared against
 * an instant parsed in the device's zone — reached through a surface nobody had
 * connected to it. `assessment.test.ts` pins it across five zones.
 */
export function isFreshGrade(
  gradedAt: string | null | undefined,
  since: string
): boolean {
  if (!gradedAt) return false;
  const t = Date.parse(gradedAt);
  // `since` is a date string (YYYY-MM-DD) meaning "from the start of that day
  // IN SINGAPORE". Singapore is +08:00 year-round and has no DST.
  const from = Date.parse(`${since}T00:00:00+08:00`);
  if (Number.isNaN(t) || Number.isNaN(from)) return false;
  return t >= from;
}

/** The top-ranked grade in the scale, or null if the scale is empty. */
export function topGradeOf(scale: GradeLevel[]): GradeLevel | null {
  if (scale.length === 0) return null;
  return scale.reduce((hi, g) => (g.rank > hi.rank ? g : hi));
}

/**
 * Build one child's row against a given level.
 *
 * `level` is null for the no-level bucket, which is where the vacuity trap
 * lives: no level means no skills means nothing to assess, and that must NOT
 * read as complete.
 */
export function buildStudentRow(
  student: RosterStudent,
  level: Level | null,
  scale: GradeLevel[],
  since: string
): StudentRow {
  const gradeById = new Map(scale.map((g) => [g.id, g]));
  const bySkill = new Map(student.progress.map((p) => [p.skill_id, p]));
  const top = topGradeOf(scale);

  const skills = [...(level?.skills ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)
  );

  const cells: Cell[] = skills.map((skill) => {
    const row = bySkill.get(skill.id) ?? null;
    // A grade id the scale no longer contains reads as ungraded rather than
    // throwing — same defensive rule as skillProgress.ts.
    const grade = row ? gradeById.get(row.grade_level_id) ?? null : null;
    return {
      skill,
      grade,
      done: grade != null && top != null && grade.rank === top.rank,
      fresh: grade != null && isFreshGrade(row?.graded_at, since),
      gradedAt: row?.graded_at ?? null,
    };
  });

  const total = cells.length;
  const freshCount = cells.filter((c) => c.fresh).length;
  const noSkills = total === 0;

  // ⚠ THE VACUITY GUARD. `freshCount === total` is TRUE when both are 0, which
  // would mark an unlevelled child — or one whose level has no skills yet —
  // as fully assessed, and send the assessor straight past them. The whole tab
  // exists to stop exactly that, so the empty case is an explicit NO.
  const assessedThisRound = !noSkills && freshCount === total;

  // A fresh grade on a skill OUTSIDE the current level means the child was
  // graded this round and then moved. Reading only the current level's skills
  // would show a just-promoted child as untouched on the day they were assessed.
  const currentSkillIds = new Set(skills.map((s) => s.id));
  const promotedThisRound = student.progress.some(
    (p) => !currentSkillIds.has(p.skill_id) && isFreshGrade(p.graded_at, since)
  );

  return {
    student,
    cells,
    freshCount,
    total,
    noSkills,
    assessedThisRound,
    promotedThisRound,
  };
}

/**
 * Group a class's roster into one sub-table per level present, plus the
 * "No level set" bucket.
 *
 * A class carries NO level of its own — `students.level_id` is per-child — so
 * one class routinely holds children at several levels, and the grid is a stack
 * of per-level tables rather than one ragged matrix.
 *
 * Levels order by sort_order; the no-level bucket sorts LAST and is only
 * present when it has children, so a tidy class never shows an empty group.
 */
export function groupRosterByLevel(
  roster: RosterStudent[],
  levels: Level[],
  scale: GradeLevel[],
  since: string
): LevelGroup[] {
  const byId = new Map(levels.map((l) => [l.id, l]));
  const ordered = [...levels].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)
  );
  const byName = (a: RosterStudent, b: RosterStudent) =>
    a.full_name.localeCompare(b.full_name);

  const groups: LevelGroup[] = [];

  for (const level of ordered) {
    const members = roster.filter((s) => s.level_id === level.id).sort(byName);
    if (members.length === 0) continue;
    groups.push({
      level,
      rows: members.map((s) => buildStudentRow(s, level, scale, since)),
    });
  }

  // A level_id pointing at a level this tenant no longer has counts as unlevelled
  // rather than vanishing from the roster — a child must never silently drop off
  // the assessment list.
  const unlevelled = roster
    .filter((s) => s.level_id == null || !byId.has(s.level_id))
    .sort(byName);

  if (unlevelled.length > 0) {
    groups.push({
      level: null,
      rows: unlevelled.map((s) => buildStudentRow(s, null, scale, since)),
    });
  }

  return groups;
}

export type RoundProgress = {
  /** Skills graded this round, across every child who has skills. */
  gradedSkills: number;
  /** Total gradeable skills — children with no skills contribute nothing. */
  totalSkills: number;
  /** Children fully assessed this round. */
  assessedStudents: number;
  /** Children on the roster, including those with nothing to grade. */
  totalStudents: number;
  /** Children who cannot be assessed at all until an admin sets a level. */
  blockedStudents: number;
};

/**
 * The header readout: how much of this class is done for the round.
 *
 * `blockedStudents` is reported SEPARATELY and deliberately, rather than being
 * counted as either done or outstanding. A child with no level is not work the
 * assessor can do — it is work for whoever sets levels — and silently folding
 * them into either bucket is how they get skipped.
 */
export function roundProgress(groups: LevelGroup[]): RoundProgress {
  const rows = groups.flatMap((g) => g.rows);
  return {
    gradedSkills: rows.reduce((n, r) => n + r.freshCount, 0),
    totalSkills: rows.reduce((n, r) => n + r.total, 0),
    assessedStudents: rows.filter((r) => r.assessedThisRound).length,
    totalStudents: rows.length,
    blockedStudents: rows.filter((r) => r.noSkills).length,
  };
}

/**
 * May this child move up, given what was assessed THIS round?
 *
 * Two conditions, both load-bearing:
 *   • Every skill of their level is at the TOP grade — the "done" rule.
 *   • Every one of those grades is FRESH. Promotion must follow from this
 *     round's own assessment; offering it off grades earned months ago would
 *     prompt the assessor to move a child they have not looked at today.
 *
 * Returns false for a child with no skills. "Every skill is at the top grade"
 * is vacuously true over an empty list, so without this an unlevelled child
 * would be offered a promotion out of a level they are not in.
 */
export function canPromote(row: StudentRow): boolean {
  if (row.noSkills) return false;
  return row.cells.every((c) => c.done && c.fresh);
}

/** The level after this one by sort_order, or null if it is the highest. */
export function nextLevel(levels: Level[], currentLevelId: string | null): Level | null {
  if (!currentLevelId) return null;
  const ordered = [...levels].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)
  );
  const i = ordered.findIndex((l) => l.id === currentLevelId);
  if (i === -1 || i === ordered.length - 1) return null;
  return ordered[i + 1];
}

/** One cell to write, as the grid collects them during a paint stroke. */
export type StrokeCell = {
  student_id: string;
  skill_id: string;
  tenant_id: string;
  grade_level_id: string;
};

/**
 * Collapse a paint stroke to one row per (student, skill), last write wins.
 *
 * ⚠ THIS IS NOT A TIDINESS PASS — WITHOUT IT THE WHOLE STROKE FAILS.
 * The stroke is sent as a single array upsert so that painting twenty cells
 * costs one request rather than twenty. But Postgres refuses an entire
 * `ON CONFLICT DO UPDATE` statement whose array names the same conflict key
 * twice ("cannot affect row a second time") — so a stroke that merely crosses
 * one cell on the way back, which a dragging finger does constantly, would
 * fail every cell in it and leave the optimistic UI showing grades that were
 * never saved.
 *
 * Order is preserved for the survivors so the request stays readable in a log.
 */
export function dedupeStroke(cells: StrokeCell[]): StrokeCell[] {
  const lastIndex = new Map<string, number>();
  cells.forEach((c, i) => lastIndex.set(`${c.student_id}:${c.skill_id}`, i));
  return cells.filter(
    (c, i) => lastIndex.get(`${c.student_id}:${c.skill_id}`) === i
  );
}
