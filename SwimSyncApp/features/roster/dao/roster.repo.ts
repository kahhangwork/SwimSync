// PostgREST table access for the coach roster screen
// (app/(coach)/classes/[id]/roster.tsx) — every `.from()` the screen makes, and
// nothing else. Stage 3 of docs/refactor/COACH_ROSTER_REFACTOR_PLAN.md.
//
// ORCHESTRATE, NEVER REPLACE. Each function returns the query builder itself,
// awaited by the caller exactly where the screen awaited it — no `.data`
// unwrap, no mapping, no error handling, no defaulting. The load reads only
// `data` and SWALLOWS every error (plan §6 Stage 3); a dao that "tidied" that
// would change behaviour while looking like a move. Query text is byte-identical
// to the screen's, comments included.
//
// dao/ is transport only: no React, no react-native, no expo-router, no ui/,
// no @/components (fence check 2).

import { supabase } from "@/lib/supabase";

// Load class info + enrolled students
export function loadClass(id: string) {
  return supabase
      .from("classes")
      .select(`
        title,
        day_of_week,
        start_time,
        end_time,
        locations(name),
        student_class_enrolments(
          is_active,
          enrolled_at,
          unenrolled_at,
          student_id,
          students(id, full_name, date_of_birth, tenant_levels(label, note, tenant_level_skills(label, sort_order)))
        )
      `)
      .eq("id", id)
      .single();
}

// Load all past sessions for this class (up to today)
export function loadPastSessions(id: string, todayDate: string) {
  return supabase
      .from("lesson_sessions")
      .select(`
        id,
        session_date,
        cancelled_at,
        cancellation_reason,
        attendance(id, student_id, status)
      `)
      .eq("class_id", id)
      .lte("session_date", todayDate)
      .order("session_date", { ascending: false });
}

// Extra lessons the admin has scheduled AHEAD. Deliberately a separate
// query rather than widening the one above: everything below treats
// `sessionData` as lessons that have already happened, and a future row in
// it would be counted as an unmarked backlog item the coach cannot yet act
// on.
export function loadUpcomingExtras(id: string, todayDate: string) {
  return supabase
      .from("lesson_sessions")
      .select("id, session_date, off_schedule_reason")
      .eq("class_id", id)
      .gt("session_date", todayDate)
      .not("off_schedule_reason", "is", null)
      .order("session_date", { ascending: true });
}

// ⚠ BOUNDED BELOW, AND DELIBERATELY NOT ABOVE — see the caller's comment.
// Both builders are returned un-awaited so the caller's Promise.all runs them
// concurrently, exactly as before.
export function loadTrialBookings(id: string, winStart: string) {
  return supabase
          .from("trial_bookings")
          .select("student_id, session_date")
          .eq("class_id", id)
          .is("cancelled_at", null)
          .gte("session_date", winStart);
}

export function loadMakeupBookings(id: string, winStart: string) {
  return supabase
          .from("makeup_bookings")
          .select("student_id, session_date")
          .eq("class_id", id)
          .is("cancelled_at", null)
          .gte("session_date", winStart);
}

export function loadGuestNames(guestIds: string[]) {
  return supabase
        .from("students")
        .select("id, full_name")
        .in("id", guestIds);
}
