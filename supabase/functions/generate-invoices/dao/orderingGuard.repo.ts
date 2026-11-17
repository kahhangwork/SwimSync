// The ordering guard's reads (orderingGuard.ts), moved verbatim
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B2). Thin: each is the original chain; every
// `if (error) throw` stays at the call site, where the guard's fail-SKIPPABLE catch
// turns any throw into "does not block".

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";

type Db = SupabaseClient<Database>;

// ── monthHasUnbilledLessons, per class ──────────────────────────────────────
export function readGuardSessions(supabase: Db, cls: { id: string }, monthStart: string, monthEnd: string) {
  return supabase
      .from("lesson_sessions")
      .select("id, session_date")
      .eq("class_id", cls.id)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd)
      .order("session_date");
}

export function readGuardTrials(supabase: Db, cls: { id: string }, monthStart: string, monthEnd: string) {
  return supabase
      .from("trial_bookings")
      .select("student_id, session_date")
      .eq("class_id", cls.id)
      .is("cancelled_at", null)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd);
}

export function readGuardMakeups(supabase: Db, cls: { id: string }, monthStart: string, monthEnd: string) {
  return supabase
      .from("makeup_bookings")
      .select("student_id, session_date")
      .eq("class_id", cls.id)
      .is("cancelled_at", null)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd);
}

export function readGuardAttendance(supabase: Db, sessionIds: string[]) {
  return supabase
          .from("attendance")
          .select("lesson_session_id, student_id, status")
          .in("lesson_session_id", sessionIds);
}

export function readGuardDrawn(supabase: Db, sessionIds: string[]) {
  return supabase
        .from("package_applications")
        .select("lesson_session_id, student_id")
        .in("lesson_session_id", sessionIds)
        .is("reversed_at", null);
}

// ── earliestBlockingEarlierMonth ────────────────────────────────────────────
export function readSealedMonths(supabase: Db, tenantId: string) {
  return supabase
      .from("billing_periods")
      .select("billing_month")
      .eq("tenant_id", tenantId);
}

export function readTenantCreatedAt(supabase: Db, tenantId: string) {
  return supabase
      .from("tenants")
      .select("created_at")
      .eq("id", tenantId)
      .maybeSingle();
}

export function readGuardClasses(supabase: Db, tenantId: string) {
  return supabase
      .from("classes")
      .select("id, day_of_week, is_active, deactivated_at")
      .eq("tenant_id", tenantId)
      .order("id");
}

export function readFirstSession(supabase: Db, classIds: string[]) {
  return supabase
      .from("lesson_sessions")
      .select("session_date")
      .in("class_id", classIds)
      .order("session_date", { ascending: true })
      .limit(1)
      .maybeSingle();
}

export function readGuardEnrolments(supabase: Db, classIds: string[]) {
  return supabase
      .from("student_class_enrolments")
      .select("student_id, class_id, enrolled_at, unenrolled_at, is_active")
      .in("class_id", classIds);
}
