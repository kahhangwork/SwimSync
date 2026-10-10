// Data access for the Make-ups page — every PostgREST read, as thin functions
// returning the raw builder ({ data, error } awaited — or `.then`-ed — by the
// caller). No mapping, no logic: rows are built in domain/makeupRows.ts, and the
// orchestration (Promise.all, the two fire-and-forget advisory loads) stays in
// domain/useMakeups.ts exactly as the page had it.
import { supabase } from "@/lib/supabase";
import type { DataOf, RlsNullable } from "@/lib/database.overrides";

// The rows each read returns. Every to-one embed is widened to `| null` — RLS nulls
// a hidden embed whatever the generated type says (§7.344) — and domain/
// makeupRows.ts keeps its `?.` / `??` / filter on each.
export type BookingSelectRow = RlsNullable<DataOf<typeof loadBookings>[number], "students" | "classes">;
type StudentSelected = DataOf<typeof loadStudents>[number];
export type StudentSelectRow = Omit<StudentSelected, "student_class_enrolments"> & {
  student_class_enrolments: RlsNullable<StudentSelected["student_class_enrolments"][number], "classes">[];
};
export type OffScheduleRow = DataOf<typeof loadOffScheduleSessions>[number];
export type AttendanceSelectRow = RlsNullable<DataOf<typeof loadAttendance>[number], "lesson_sessions">;
export type ParentLinkRow = DataOf<typeof loadParentLinks>[number];

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

// One-child packages' children (single-child packages, 20261010000100), for the
// expiry advisory: a sibling's own package never covers this child.
export function loadPackageChildren() {
  return supabase.from("parent_packages").select("id, student_id").not("student_id", "is", null);
}
