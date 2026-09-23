// Every read the coach grade viewer makes (docs/refactor/BATCH_FGH_PLAN.md, app
// fence) — READ-ONLY, as the screen is. Raw builders, byte-identical to the chains
// they replaced in app/(coach)/classes/[id]/grade.tsx.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchStudentLevel = (studentId: string) =>
  supabase
    .from("students")
    .select(
      "full_name, tenant_id, tenant_levels(label, note, tenant_level_skills(id, label, sort_order))"
    )
    .eq("id", studentId)
    .single();

export const fetchGradeScale = (tenantId: string) =>
  supabase
    .from("skill_grade_levels")
    .select("id, rank, label")
    .eq("tenant_id", tenantId)
    .order("rank");

export const fetchSkillProgress = (studentId: string) =>
  supabase
    .from("student_skill_progress")
    .select("skill_id, grade_level_id")
    .eq("student_id", studentId);
