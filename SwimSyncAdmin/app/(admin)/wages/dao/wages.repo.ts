// Data access for the Wages page — every PostgREST read/write, as thin
// functions returning the raw builder ({ data, error } awaited by the caller).
// No mapping, no logic, ONE QUERY EACH: domain/usePayroll keeps the multi-round-
// trip orchestration, because its isStale() checks sit BETWEEN the awaits and
// are load-bearing (a stale row carries an irreversible "Mark paid").
import { supabase } from "@/lib/supabase";

export function getAuthUser() {
  return supabase.auth.getUser();
}

export function loadProfileTenant(userId: string) {
  return supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
}

export function loadTenantPolicy(tenantId: string) {
  return supabase
    .from("tenants")
    .select("rain_pays_coach, wage_run_day")
    .eq("id", tenantId)
    .maybeSingle();
}

export function updateTenant(tenantId: string, patch: Record<string, unknown>) {
  return supabase.from("tenants").update(patch).eq("id", tenantId);
}

export function loadCoaches(tid: string) {
  return supabase
    .from("coaches")
    .select("id, profiles(full_name), coach_rates(amount, unit_minutes, effective_from, role)")
    .eq("tenant_id", tid);
}

// The ITEMS, not a count of them. A lesson's amount for a coach is the sum
// of a set now, and the count of items is not the count of lessons.
export function loadPayouts(tenantId: string, period: string) {
  return supabase
    .from("coach_payouts")
    .select(
      "id, coach_id, gross_amount, status, coach_payout_items(id, lesson_session_id, class_title, session_date, basis, minutes, amount, is_adjustment, original_period)"
    )
    .eq("tenant_id", tenantId)
    .eq("period_month", period);
}

// ⚠ BY TENANT, NOT `.in(sessionIds)` — see the note at the call site in
// domain/usePayroll (a 414 on the query whose job is labelling covers).
export function loadSessionCoaches(tenantId: string) {
  return supabase
    .from("session_coaches")
    .select("lesson_session_id, coach_id")
    .eq("tenant_id", tenantId);
}

export function loadClassShadowCoaches(tenantId: string) {
  return supabase
    .from("class_shadow_coaches")
    .select("class_id, coach_id, effective_from, effective_to")
    .eq("tenant_id", tenantId);
}

export function loadSessionCoachAbsences(tenantId: string) {
  return supabase
    .from("session_coach_absences")
    .select("lesson_session_id, coach_id")
    .eq("tenant_id", tenantId);
}

// Scoped to the SHADOWED classes — see the call site in domain/usePayroll.
export function loadLessonSessionsForClasses(classIds: string[]) {
  return supabase
    .from("lesson_sessions")
    .select("id, class_id, session_date")
    .in("class_id", classIds);
}

// INSERT, never UPDATE — a new effective-dated row. Editing the old one in
// place would reprice every month it had already covered.
// ⚠ role IS REQUIRED, never left to the column default. The default is 'main',
// so a shadow rate saved without it becomes a second main rate and the two race
// on effective_from.
export type CoachRateInsert = {
  coach_id: string;
  amount: number;
  unit_minutes: number;
  effective_from: string;
  role: "main" | "shadow";
};
export function insertCoachRate(row: CoachRateInsert) {
  return supabase.from("coach_rates").insert(row);
}
