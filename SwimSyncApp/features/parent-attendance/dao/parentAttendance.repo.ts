// Every PostgREST read the parent Attendance tab makes (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). Each returns the RAW builder — byte-identical to the chain it replaced
// in app/(parent)/attendance/index.tsx; the hook's awaits, its Promise.all shape
// and its per-result `error` reads are unchanged.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

type Session = { id: string };

export const fetchParentId = (session: Session) =>
  supabase
    .from("parents")
    .select("id")
    .eq("profile_id", session.id)
    .single();

export const fetchChildLinks = (parentId: string) =>
  supabase
    .from("parent_students")
    .select("students(id, full_name, assignment_status, is_active)")
    .eq("parent_id", parentId);

export const fetchAttendance = (childId: string) =>
  supabase
    .from("attendance")
    .select(`
        id,
        status,
        lesson_sessions(
          session_date,
          classes(title)
        )
      `)
    .eq("student_id", childId);

export const fetchActiveEnrolments = (childId: string) =>
  supabase
    .from("student_class_enrolments")
    .select("enrolled_at, classes(id, day_of_week, title, start_time, end_time)")
    .eq("student_id", childId)
    .eq("is_active", true);

export const fetchUpcomingHolidays = (today: string, horizon: string) =>
  supabase
    .from("tenant_public_holidays")
    .select("holiday_date")
    .gte("holiday_date", today)
    .lte("holiday_date", horizon);

export const fetchUpcomingMakeups = (childId: string, today: string, horizon: string) =>
  supabase
    .from("makeup_bookings")
    .select(
      "id, session_date, classes!makeup_bookings_class_id_fkey(id, title, start_time, end_time)"
    )
    .eq("student_id", childId)
    .is("cancelled_at", null)
    .gte("session_date", today)
    .lte("session_date", horizon);

// Extra lessons that are still ON. `cancelled_at` is the flag the admin's
// cancel_lesson() sets (20260821000700); a cancelled extra is read by the
// query below and rendered struck, never as a live "Extra lesson"
// (plan RISK 5 — the Phase A forward-debt, paid here).
export const fetchUpcomingExtras = (classIds: string[], today: string, horizon: string) =>
  supabase
    .from("lesson_sessions")
    .select("class_id, session_date, start_time, end_time, classes(title)")
    .not("off_schedule_reason", "is", null)
    .is("cancelled_at", null)
    .in("class_id", classIds)
    .gte("session_date", today)
    .lte("session_date", horizon);

// Lessons the admin cancelled in advance, in any of the child's classes —
// shown struck "Cancelled" so the parent sees WHY there is no lesson.
export const fetchUpcomingCancelled = (classIds: string[], today: string, horizon: string) =>
  supabase
    .from("lesson_sessions")
    .select("class_id, session_date, start_time, end_time, cancellation_reason, classes(title)")
    .not("cancelled_at", "is", null)
    .in("class_id", classIds)
    .gte("session_date", today)
    .lte("session_date", horizon);
