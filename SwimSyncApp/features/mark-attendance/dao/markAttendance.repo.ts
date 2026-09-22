// Every PostgREST read/write of the marking screen (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stages 3–4). Each returns the RAW builder — { data, error } when awaited — with no
// mapping, no unwrap and no error handling: the hook's handling must not change by
// one character. Query text is byte-identical to the route it came from (checked by
// script, terminals included — .single() vs .maybeSingle() changes a branch).
import { supabase } from "@/lib/supabase";

// ── load() ──────────────────────────────────────────────────────────────

export const loadClass = (id: string) =>
  supabase
        .from("classes")
        .select(`
        title,
        day_of_week,
        coach_id,
        student_class_enrolments(
          is_active,
          enrolled_at,
          unenrolled_at,
          students(id, full_name)
        )
      `)
        .eq("id", id)
        .single();

export const loadMyCoach = (profileId: string) =>
  supabase
            .from("coaches")
            .select("id")
            .eq("profile_id", profileId)
            .maybeSingle();

export const loadSession = (id: string, date: string) =>
  supabase
      .from("lesson_sessions")
      .select("id, cancelled_at, cancellation_reason")
      .eq("class_id", id)
      .eq("session_date", date)
      .maybeSingle();

export const loadMyRosterRow = (sid: string) =>
  supabase
              .from("session_coaches")
              .select("coach_id")
              .eq("lesson_session_id", sid)
              .maybeSingle();

export const loadAttendance = (sid: string) =>
  supabase
          .from("attendance")
          .select("id, student_id, status, students(id, full_name)")
          .eq("lesson_session_id", sid);

export const loadTrialBookings = (id: string, date: string) =>
  supabase
      .from("trial_bookings")
      .select("student_id, students(id, full_name)")
      .eq("class_id", id)
      .eq("session_date", date)
      .is("cancelled_at", null);

export const loadMakeupBookings = (id: string, date: string) =>
  supabase
      .from("makeup_bookings")
      .select("student_id, students(id, full_name)")
      .eq("class_id", id)
      .eq("session_date", date)
      .is("cancelled_at", null);
