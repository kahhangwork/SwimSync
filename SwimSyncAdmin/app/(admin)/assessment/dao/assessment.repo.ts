// Data access for the Assessment index — every PostgREST read, as thin
// functions returning the raw builder ({ data, error } awaited by the caller).
// No mapping, no logic: the checklist rows are built in domain/assessmentRows.ts,
// orchestration (Promise.all, the error bail-outs) in domain/useAssessmentIndex.ts.
import { supabase } from "@/lib/supabase";

export function loadLevels() {
  return supabase
    .from("tenant_levels")
    .select("id, label, sort_order, tenant_level_skills(id, label, sort_order)")
    .order("sort_order");
}

export function loadGradeScale() {
  return supabase.from("skill_grade_levels").select("id, rank, label").order("rank");
}

export function loadActiveClasses() {
  return supabase
    .from("classes")
    .select(
      "id, title, day_of_week, start_time, is_active, coaches(profiles(full_name)), locations(name)"
    )
    // ACTIVE classes only — a retired class has nobody left to assess, and
    // listing it would put permanent unfinishable work on the checklist.
    .eq("is_active", true)
    .order("day_of_week")
    .order("start_time");
}

export function loadEnrolments(classIds: string[]) {
  return supabase
    .from("student_class_enrolments")
    .select("class_id, students(id, full_name, level_id)")
    .in("class_id", classIds)
    .eq("is_active", true);
}

export function loadProgress(studentIds: string[]) {
  return supabase
    .from("student_skill_progress")
    .select("student_id, skill_id, grade_level_id, graded_at")
    .in("student_id", studentIds);
}
