// Slice 6 — the tenant's level ladder (inline picker) and grading ONE child's
// skills. Stage 9 of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from
// page.tsx intact.
//
// ── Grade skills, for ONE child (the Assessment tab does whole classes) ────
// This is the one-off correction: a child was mis-graded, or joined after the
// class was assessed. The round machinery still applies — `since` is today, so
// a grade from a previous round shows greyed and dated exactly as it does in
// the class grid, and a correction made here reads as fresh.

import { useState } from "react";
import type {
  GradeLevel as SkillGradeLevel,
  Level as SkillLevel,
  RosterStudent,
} from "@/lib/assessment";
import * as repo from "../dao/students.repo";
import type { StudentRow } from "../types";

export function useGrading(reload: () => Promise<void>) {
  const [levels, setLevels] = useState<{ id: string; label: string }[]>([]);
  const [gradingFor, setGradingFor] = useState<StudentRow | null>(null);
  const [gradeLevels, setGradeLevels] = useState<SkillLevel[]>([]);
  const [gradeScale, setGradeScale] = useState<SkillGradeLevel[]>([]);
  const [gradeRoster, setGradeRoster] = useState<RosterStudent[]>([]);
  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [savingLevelFor, setSavingLevelFor] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);

  async function loadLevels() {
    // RLS scopes this to the caller's own business. Ordered by sort_order, not
    // by label — a ladder sorted alphabetically puts "Advanced" above
    // "Beginner", which is why sort_order exists at all.
    const { data } = await repo.fetchLevels();
    setLevels(data ?? []);
  }

  // Fetches everything the grid needs for ONE child. Kept separate from
  // loadLevels() above, which deliberately reads only id + label for the inline
  // dropdown — the grid additionally needs each level's skills and the tenant's
  // grade scale, and loading those on every Students page render would be a
  // per-row cost paid by the many admins who never grade from here.
  async function openGrading(student: StudentRow) {
    setGradingFor(student);
    setGradeLoading(true);
    setGradeError(null);

    const [levelsRes, scaleRes, progRes] = await Promise.all([
      repo.fetchLevelsWithSkills(),
      repo.fetchGradeScale(),
      repo.fetchSkillProgress(student.id),
    ]);

    const failed = levelsRes.error || scaleRes.error || progRes.error;
    if (failed) {
      // Surfaced, not swallowed: an empty grid that is really a failed query
      // reads as "this child has no skills", which would invite re-grading work
      // that already exists.
      setGradeError(failed.message);
      setGradeLoading(false);
      return;
    }

    setGradeLevels(
      (levelsRes.data ?? []).map((l: any) => ({
        id: l.id,
        label: l.label,
        sort_order: l.sort_order,
        skills: l.tenant_level_skills ?? [],
      }))
    );
    setGradeScale((scaleRes.data ?? []) as SkillGradeLevel[]);
    setGradeRoster([
      {
        id: student.id,
        full_name: student.full_name,
        level_id: student.level_id,
        progress: (progRes.data ?? []) as any,
      },
    ]);
    setGradeLoading(false);
  }

  async function setLevel(student: StudentRow, levelId: string | null) {
    setSavingLevelFor(student.id);
    setLevelError(null);
    const { error } = await repo.updateStudentLevel(student.id, levelId);
    setSavingLevelFor(null);

    if (error) {
      // 23514 is the database refusing a level from another business. Not
      // reachable from this picker, which only lists our own — but if it ever
      // fires, saying "try again" would invite a retry that cannot succeed.
      setLevelError(
        error.code === "23514"
          ? "That level belongs to a different business."
          : `Could not update ${student.full_name}'s level.`
      );
      return;
    }
    reload();
  }

  return {
    levels,
    loadLevels,
    gradingFor,
    gradeLevels,
    gradeScale,
    gradeRoster,
    gradeLoading,
    gradeError,
    savingLevelFor,
    levelError,
    openGrading,
    closeGrading: () => {
      setGradingFor(null);
      setGradeError(null);
    },
    setLevel,
  };
}

export type GradingState = ReturnType<typeof useGrading>;
