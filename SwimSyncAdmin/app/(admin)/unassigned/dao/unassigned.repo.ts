// Unassigned page — PostgREST table access. Thin functions returning the raw
// { data, error }; no logic, no mapping (that lives in domain/).

import { supabase } from "@/lib/supabase";
import type { DataOf, RlsNullable } from "@/lib/database.overrides";

// The rows each read returns. Every to-one embed is widened to `| null` — RLS
// nulls a hidden embed whatever the generated type says (§7.344) — and domain/
// keeps its `?.` / `??` on each.
type StudentSelected = DataOf<typeof loadUnassignedStudents>[number];
type ParentSelected = NonNullable<StudentSelected["parent_students"][number]["parents"]>;
export type UnassignedStudentRow = Omit<StudentSelected, "parent_students"> & {
  parent_students: { parents: RlsNullable<ParentSelected, "profiles"> | null }[];
};
export type CoachSelectRow = RlsNullable<DataOf<typeof loadCoaches>[number], "profiles">;
export type ClassOptionRow = DataOf<typeof loadClassesForCoach>[number];

// SGT calendar date (YYYY-MM-DD). Kept exactly as the page computed it; the
// trial queries below filter on it.
function todaySg(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

export function loadUnassignedStudents() {
  return supabase
    .from("students")
    .select("id, full_name, parent_students(parents(profiles(full_name)))")
    .eq("assignment_status", "unassigned")
    .eq("is_active", true)
    .order("full_name");
}

// ⚠ A CHILD WITH AN UPCOMING TRIAL IS NOT WAITING FOR YOU. A trial is a
// BOOKING, not an enrolment, so a booked child sits at assignment_status =
// 'unassigned' and would appear here as though they needed placing. They do
// not: they are already expected at one specific lesson, the coach already sees
// them, and the invoice engine already counts them. The domain layer excludes
// these ids from the list.
export function loadUpcomingTrials() {
  return supabase
    .from("trial_bookings")
    .select("student_id")
    .is("cancelled_at", null)
    .gte("session_date", todaySg());
}

export function loadCoaches() {
  return supabase.from("coaches").select("id, profiles(full_name)").order("id");
}

export function loadClassesForCoach(coachId: string) {
  return supabase
    .from("classes")
    .select(
      "id, title, day_of_week, start_time, student_class_enrolments(id, is_active)"
    )
    .eq("coach_id", coachId)
    .eq("is_active", true)
    .order("day_of_week")
    .order("start_time");
}

// The one live trial (if any) for a child about to be enrolled — the guard
// against silently blocking a billing month by enrolling a one-lesson trialist.
export function loadLiveTrial(studentId: string) {
  return supabase
    .from("trial_bookings")
    .select("session_date")
    .eq("student_id", studentId)
    .is("cancelled_at", null)
    .gte("session_date", todaySg())
    .order("session_date")
    .limit(1);
}

// Enrolling goes through set_enrolment_start (lib/enrolmentStart.rpc.ts) —
// one atomic, audited call (20261005000100). No direct insert here.
