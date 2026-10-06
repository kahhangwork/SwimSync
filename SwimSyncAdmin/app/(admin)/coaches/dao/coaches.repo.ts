// Coaches page — PostgREST table access. Thin wrappers returning raw
// { data, error }; no logic, no mapping (that lives in domain/).

import { supabase } from "@/lib/supabase";
import type { DataOf, RlsNullable } from "@/lib/database.overrides";

// The rows the mapped reads return. Every to-one embed is widened to `| null` —
// RLS nulls a hidden embed whatever the generated type says (§7.344) — and the
// session_coaches embeds are typed `| X[]` too because domain/coachesRows.ts
// keeps its Array.isArray normalisers.
export type CoachSelectRow = RlsNullable<DataOf<typeof loadCoaches>[number], "profiles">;
type SessionSelected = NonNullable<DataOf<typeof loadSessionCoaches>[number]["lesson_sessions"]>;
type ClassSelected = NonNullable<SessionSelected["classes"]>;
type SessionEmbed = Omit<SessionSelected, "classes"> & {
  classes: ClassSelected | ClassSelected[] | null;
};
export type SessionCoachRow = { lesson_sessions: SessionEmbed | SessionEmbed[] | null };

export function loadCoaches() {
  return supabase
    .from("coaches")
    .select(
      "id, profile_id, disabled_at, profiles(full_name, email, phone), classes(title, is_active)"
    )
    .order("id");
}

// ⚠ RISK 8 pre-flight — the same query shapes as the invoice run. The
// completeness rule itself comes from domain/coachDisableImpact (§7.18: one
// definition, never re-derived).
export function loadSessionCoaches(coachId: string) {
  return supabase
    .from("session_coaches")
    .select("lesson_sessions(id, class_id, session_date, classes(title))")
    .eq("coach_id", coachId);
}

export function loadEnrolments(classIds: string[]) {
  return supabase
    .from("student_class_enrolments")
    .select("class_id, student_id, is_active, enrolled_at, unenrolled_at")
    .in("class_id", classIds);
}

export function loadAttendance(sessionIds: string[]) {
  return supabase
    .from("attendance")
    .select("lesson_session_id, student_id")
    .in("lesson_session_id", sessionIds);
}

export function loadTrials(classIds: string[], dates: string[]) {
  return supabase
    .from("trial_bookings")
    .select("class_id, student_id, session_date")
    .in("class_id", classIds)
    .in("session_date", dates)
    .is("cancelled_at", null);
}

export function loadMakeups(classIds: string[], dates: string[]) {
  return supabase
    .from("makeup_bookings")
    .select("class_id, student_id, session_date")
    .in("class_id", classIds)
    .in("session_date", dates)
    .is("cancelled_at", null);
}
