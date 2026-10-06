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
import type { RlsNullable } from "@/lib/database.overrides";

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
    // class_coach_terms, not class_rates — see lib/calendarData.ts (20261005000200).
    supabase.rpc("class_coach_terms", { p_class_ids: [classId] }),
    supabase.from("class_shadow_coaches").select("class_id, coach_id, effective_from, effective_to").eq("class_id", classId),
    supabase.from("tenants").select("holiday_extension_days").limit(1).maybeSingle(),
    supabase
      .from("students")
      .select("id, full_name, is_active, student_class_enrolments(is_active, classes(id, title, category_id))")
      .order("full_name"),
  ]);
}

// The rows each read returns, by its position in loadLessonReads. Every to-one
// embed is widened to `| null` — RLS nulls a hidden embed whatever the generated
// type says (§7.344) — and the domain keeps its `?.` / `??` / filter on each.
type LessonReads = Awaited<ReturnType<typeof loadLessonReads>>;
type DataAt<I extends 1 | 3 | 4 | 5 | 10> = NonNullable<LessonReads[I]["data"]>;
export type ClassReadRow = RlsNullable<DataAt<1>, "locations" | "class_categories">;
export type CoachReadRow = RlsNullable<DataAt<3>[number], "profiles">;
export type EnrolmentReadRow = RlsNullable<DataAt<4>[number], "students">;
/** A trial (position 5) or make-up (6) booking — the two selects are identical. */
export type GuestReadRow = RlsNullable<DataAt<5>[number], "students">;
type KidSelected = DataAt<10>[number];
type KidEnrolment = KidSelected["student_class_enrolments"][number];
export type KidReadRow = Omit<KidSelected, "student_class_enrolments"> & {
  student_class_enrolments: RlsNullable<KidEnrolment, "classes">[];
};

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
