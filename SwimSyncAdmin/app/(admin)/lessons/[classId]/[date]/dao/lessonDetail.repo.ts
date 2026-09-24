// PostgREST table access for the admin lesson page (lessons/[classId]/[date]) —
// every `.from()` and auth read this page makes, and nothing else. Stage 2 of
// docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md.
//
// ORCHESTRATE, NEVER REPLACE. Each function returns the raw results: no
// mapping, no error handling, no defaulting. The load's error handling lives in
// the hook (domain/lessonLoadErrors.ts): since 2026-09-24 it checks EVERY read
// here, so a failed read can never render as an empty one.
//
// dao/ is transport only: no React, no ui/, no @/components (fence check 2).

import { supabase } from "@/lib/supabase";

// Reads the markable window's floor itself (an RPC inside lib/markableFloor,
// shared with the Lessons list's dao), so it is BOUND here rather than
// re-implemented — the page's tiers never import @/lib/markableFloor.
export { fetchMarkableFloor } from "@/lib/markableFloor";

/**
 * The lesson's eleven reads, in ONE Promise.all, in the page's original order —
 * the hook destructures them positionally with the same names.
 */
export function loadLessonReads(classId: string, date: string) {
  return Promise.all([
    supabase.auth.getSession(),
    supabase
      .from("classes")
      .select("id, title, day_of_week, start_time, end_time, location_id, locations(name), coach_id, category_id, colour, capacity, is_active, deactivated_at, class_categories(default_capacity)")
      .eq("id", classId)
      .maybeSingle(),
    supabase.from("lesson_sessions").select("id, cancelled_at, cancellation_reason").eq("class_id", classId).eq("session_date", date).maybeSingle(),
    supabase.from("coaches").select("id, profiles(full_name)"),
    supabase
      .from("student_class_enrolments")
      .select("student_id, enrolled_at, unenrolled_at, students(full_name)")
      .eq("class_id", classId),
    supabase.from("trial_bookings").select("id, student_id, students(full_name)").eq("class_id", classId).eq("session_date", date).is("cancelled_at", null),
    supabase.from("makeup_bookings").select("id, student_id, students(full_name)").eq("class_id", classId).eq("session_date", date).is("cancelled_at", null),
    supabase.from("class_rates").select("class_id, effective_from, paid_coach_id").eq("class_id", classId),
    supabase.from("class_shadow_coaches").select("class_id, coach_id, effective_from, effective_to").eq("class_id", classId),
    supabase.from("tenants").select("holiday_extension_days").limit(1).maybeSingle(),
    supabase
      .from("students")
      .select("id, full_name, is_active, student_class_enrolments(is_active, classes(id, title, category_id))")
      .order("full_name"),
  ]);
}

/** Attendance + substitute only exist when the session does. */
export function loadSessionReads(sid: string) {
  return Promise.all([
    supabase.from("attendance").select("student_id, status").eq("lesson_session_id", sid),
    supabase.from("session_coaches").select("id, lesson_session_id, coach_id").eq("lesson_session_id", sid),
    supabase.from("session_coach_absences").select("lesson_session_id, coach_id").eq("lesson_session_id", sid),
  ]);
}

/** Remove the substitute (back to the class's regular coach). */
export function deleteSessionCoach(subRowId: string) {
  return supabase.from("session_coaches").delete().eq("id", subRowId);
}
