// Data access for assessing one class — every PostgREST read and write, as thin
// functions returning the raw builder ({ data, error } awaited by the caller).
// No mapping, no logic: the roster is built in domain/assessClassRows.ts,
// orchestration (Promise.all, the error bail-outs) in domain/useAssessClass.ts.
//
// The three WRITES are the grid's (components/AssessmentGrid.tsx), injected
// into it as `writes` so the shared component holds no client (Admin L-D,
// BATCH_D_PLAN.md). Each is the grid's query verbatim; the grid keeps every
// piece of orchestration around them (dedupe, snapshot, rollback, reload).
import { supabase } from "@/lib/supabase";
import type { StrokeCell } from "@/lib/assessment";

export function loadClass(classId: string) {
  return supabase
    .from("classes")
    .select("title, day_of_week, start_time, tenant_id, locations(name)")
    .eq("id", classId)
    .single();
}

export function loadLevels() {
  return supabase
    .from("tenant_levels")
    .select("id, label, sort_order, tenant_level_skills(id, label, sort_order)")
    .order("sort_order");
}

export function loadGradeScale() {
  return supabase.from("skill_grade_levels").select("id, rank, label").order("rank");
}

export function loadEnrolments(classId: string) {
  return supabase
    .from("student_class_enrolments")
    .select("students(id, full_name, level_id)")
    .eq("class_id", classId)
    .eq("is_active", true);
}

export function loadProgress(studentIds: string[]) {
  return supabase
    .from("student_skill_progress")
    .select("student_id, skill_id, grade_level_id, graded_at")
    .in("student_id", studentIds);
}

// ── The grid's writes ────────────────────────────────────────────────────────

export function upsertGrades(cells: StrokeCell[]) {
  return supabase
    .from("student_skill_progress")
    .upsert(cells, { onConflict: "student_id,skill_id" });
}

export function clearGrade(studentId: string, skillId: string) {
  return supabase
    .from("student_skill_progress")
    .delete()
    .eq("student_id", studentId)
    .eq("skill_id", skillId);
}

export function promoteStudent(studentId: string, levelId: string) {
  return supabase
    .from("students")
    .update({ level_id: levelId })
    .eq("id", studentId);
}
