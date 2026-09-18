// Data access for the Trials page — every PostgREST read/write, as thin
// functions returning the raw builder ({ data, error } awaited by the caller).
// No mapping, no logic: rows are built in domain/trialRows.ts, and every await
// boundary of the multi-round-trip load and of the Convert flow (RISK 2 — the
// two-press guard's order) stays in domain/useTrials.ts.
import { supabase } from "@/lib/supabase";

export function getAuthUser() {
  return supabase.auth.getUser();
}

export function profileTenant(userId: string) {
  return supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
}

export function loadActiveClasses() {
  return supabase
    .from("classes")
    .select("id, title, day_of_week")
    .eq("is_active", true)
    .order("title");
}

export function loadCategories() {
  return supabase.from("class_categories").select("id, name").order("name");
}

export function loadTrialRates() {
  return supabase
    .from("trial_rates")
    .select("category_id, rate, effective_from")
    .order("effective_from", { ascending: false });
}

export function loadBookings() {
  return supabase
    .from("trial_bookings")
    .select(
      "id, session_date, student_id, class_id, students(full_name), classes(title)"
    )
    .is("cancelled_at", null)
    .order("session_date");
}

export function loadAttendance(studentIds: string[]) {
  return supabase
    .from("attendance")
    .select("student_id, lesson_sessions(session_date)")
    .in("student_id", studentIds);
}

export function loadStudents() {
  return supabase
    .from("students")
    .select("id, full_name, is_active, student_class_enrolments(is_active)")
    .order("full_name");
}

// ── Convert ─────────────────────────────────────────────────────────────────

/** The child's next uncancelled trial on or after `todaySg`. Same query
 *  Unassigned Children runs. */
export function loadFutureLiveTrial(studentId: string, todaySg: string) {
  return supabase
    .from("trial_bookings")
    .select("session_date")
    .eq("student_id", studentId)
    .is("cancelled_at", null)
    .gte("session_date", todaySg)
    .order("session_date")
    .limit(1);
}

export function insertEnrolment(studentId: string, classId: string) {
  return supabase
    .from("student_class_enrolments")
    .insert({ student_id: studentId, class_id: classId, is_active: true });
}

export function markAssigned(studentId: string) {
  return supabase
    .from("students")
    .update({ assignment_status: "assigned" })
    .eq("id", studentId);
}

// ── Rates ───────────────────────────────────────────────────────────────────

/** A new effective-dated ROW, never an update (§7.3). */
export function insertTrialRate(row: {
  tenant_id: string | null;
  category_id: string;
  rate: number;
  effective_from: string;
  created_by: string | undefined;
}) {
  return supabase.from("trial_rates").insert(row);
}
