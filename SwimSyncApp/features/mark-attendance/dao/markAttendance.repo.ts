// Every PostgREST read/write of the marking screen (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stages 3–4). Each returns the RAW builder — { data, error } when awaited — with no
// mapping, no unwrap and no error handling: the hook's handling must not change by
// one character. Query text is byte-identical to the route it came from (checked by
// script, terminals included — .single() vs .maybeSingle() changes a branch).
import { supabase } from "@/lib/supabase";
import type { buildAttendanceRows } from "@/lib/attendancePayload";

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

// ── handleSave() ────────────────────────────────────────────────────────

export const loadCoachRecord = (profileId: string) =>
  supabase
      .from("coaches")
      .select("id")
      .eq("profile_id", profileId)
      .single();

export const loadSessionId = (id: string, date: string) =>
  supabase
        .from("lesson_sessions")
        .select("id")
        .eq("class_id", id)
        .eq("session_date", date)
        .maybeSingle();

export const createSession = (id: string, date: string) =>
  supabase
        .from("lesson_sessions")
        .insert({ class_id: id, session_date: date, status: "scheduled" })
        .select("id")
        .single();

export const upsertAttendance = (rows: ReturnType<typeof buildAttendanceRows>) =>
  supabase
      .from("attendance")
      .upsert(rows, { onConflict: "lesson_session_id,student_id" });

export const deleteAbsences = (sid: string, coachIds: string[]) =>
  supabase
              .from("session_coach_absences")
              .delete()
              .eq("lesson_session_id", sid)
              .in("coach_id", coachIds);

export const upsertAbsences = (
  rows: { lesson_session_id: string; coach_id: string; tenant_id: string; marked_by: string }[]
) =>
  supabase.from("session_coach_absences").upsert(
              rows,
              { onConflict: "lesson_session_id,coach_id" }
            );

export const insertAuditLog = (row: Record<string, unknown>) =>
  supabase.from("audit_log").insert(row);
