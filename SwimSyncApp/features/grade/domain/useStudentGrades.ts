// The coach grade viewer's load (docs/refactor/BATCH_FGH_PLAN.md, app fence) — moved
// VERBATIM from app/(coach)/classes/[id]/grade.tsx, builders now dao calls. loadData
// keeps its deps ([studentId]); the route's useFocusEffect is keyed on it.
//
// `summary` was computed on the route after its loading guard; it is a pure
// function of skills / grades / scale, so computing it here every render gives the
// same value wherever it is read.
import { useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  summariseSkillProgress,
  type GradeLevel,
  type LevelSkill,
} from "@/lib/skillProgress";
import { fetchStudentLevel, fetchGradeScale, fetchSkillProgress } from "../dao/grade.repo";
import type { StudentLevelRow } from "../dao/grade.repo";
import type { StudentInfo } from "../types";

export function useStudentGrades() {
  const { studentId } = useLocalSearchParams<{ id: string; studentId: string }>();

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [skills, setSkills] = useState<LevelSkill[]>([]);
  const [scale, setScale] = useState<GradeLevel[]>([]);
  // skill_id → grade_level_id for every graded skill.
  const [grades, setGrades] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: s } = await fetchStudentLevel(studentId);

    if (!s) {
      setStudent(null);
      setLoading(false);
      return;
    }

    // PostgREST returns the to-one tenant_levels embed as an object (or null).
    // Typed from the select since Wave 8 (StudentLevelRow) — the §7.28 cast is gone.
    const level: StudentLevelRow["tenant_levels"] = s.tenant_levels;
    setStudent({
      full_name: s.full_name,
      tenant_id: s.tenant_id,
      level_label: level?.label ?? null,
      level_note: level?.note ?? null,
    });
    setSkills(
      [...((level?.tenant_level_skills as LevelSkill[]) ?? [])].map((sk) => ({
        id: sk.id,
        label: sk.label,
        sort_order: sk.sort_order,
      }))
    );

    // The tenant's grade scale, and this child's existing grades. Both scoped
    // by RLS to the coach's own business already; the tenant filter is belt-and-
    // braces and makes the query self-documenting.
    const [{ data: scaleRows }, { data: progressRows }] = await Promise.all([
      fetchGradeScale(s.tenant_id),
      fetchSkillProgress(studentId),
    ]);

    setScale((scaleRows as GradeLevel[]) ?? []);
    setGrades(
      Object.fromEntries(
        (progressRows ?? []).map((p) => [p.skill_id, p.grade_level_id])
      )
    );
    setLoading(false);
  }, [studentId]);

  const summary = summariseSkillProgress(
    skills,
    Object.entries(grades).map(([skill_id, grade_level_id]) => ({ skill_id, grade_level_id })),
    scale
  );

  return {
    loading,
    student,
    skills,
    scale,
    loadData,
    summary,
  };
}
