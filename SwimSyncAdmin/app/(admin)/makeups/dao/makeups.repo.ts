// Data access for the Make-ups page — every PostgREST read, as thin functions
// returning the raw builder ({ data, error } awaited — or `.then`-ed — by the
// caller). No mapping, no logic: rows are built in domain/makeupRows.ts, and the
// orchestration (Promise.all, the two fire-and-forget advisory loads) stays in
// domain/useMakeups.ts exactly as the page had it.
import { supabase } from "@/lib/supabase";

export function loadActiveClasses() {
  return supabase
    .from("classes")
    .select("id, title, day_of_week, category_id")
    .eq("is_active", true)
    .order("title");
}

export function loadBookings() {
  return supabase
    .from("makeup_bookings")
    .select(
      "id, session_date, student_id, students(full_name), classes!makeup_bookings_class_id_fkey(title)"
    )
    .is("cancelled_at", null)
    .order("session_date");
}

export function loadStudents() {
  return supabase
    .from("students")
    .select(
      "id, full_name, is_active, student_class_enrolments(is_active, classes(id, title, category_id))"
    )
    .order("full_name");
}

/** `today` is todayInSg(), passed in — this file reads no clock. */
export function loadOffScheduleSessions(today: string) {
  return supabase
    .from("lesson_sessions")
    .select("class_id, session_date")
    .not("off_schedule_reason", "is", null)
    .gte("session_date", today);
}

export function loadAttendance(studentIds: string[]) {
  return supabase
    .from("attendance")
    .select("student_id, lesson_sessions(session_date)")
    .in("student_id", studentIds);
}

export function loadParentLinks(studentIds: string[]) {
  return supabase
    .from("parent_students")
    .select("parent_id, student_id")
    .in("student_id", studentIds);
}
