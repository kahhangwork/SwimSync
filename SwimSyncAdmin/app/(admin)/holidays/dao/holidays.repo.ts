// dao/ — data access for the Holidays page. Transport only (no React, no
// presentation — tierBoundaries check 2). The client is bound here; the page
// and hook never import @/lib/supabase (check 4).
import { supabase } from "@/lib/supabase";
import type { Holiday } from "../types";

export type { Holiday };

/** The signed-in admin's tenant (getUser -> profiles). */
export async function myTenantId(): Promise<string | null> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.user.id)
    .single();
  return (data?.tenant_id as string | null) ?? null;
}

/** The tenant's holiday_extension_days. null means "no tenant row — leave the
 *  input alone"; a found row yields its value, or 7 when the column is null
 *  (matches the page's original `if (t) setExtDays(value ?? 7)`). */
export async function loadExtensionDays(tenant: string): Promise<number | null> {
  const { data } = await supabase
    .from("tenants")
    .select("holiday_extension_days")
    .eq("id", tenant)
    .single();
  if (!data) return null;
  return (data.holiday_extension_days as number) ?? 7;
}

export async function loadHolidays(): Promise<Holiday[]> {
  const { data } = await supabase
    .from("tenant_public_holidays")
    .select("id, holiday_date, name")
    .order("holiday_date");
  return (data ?? []) as Holiday[];
}

/** Raw 'holiday'-status attendance rows for the tenant, for the void-count map. */
export async function loadVoidedRows(
  tenant: string
): Promise<{ lesson_sessions: { session_date: string } | null }[]> {
  const { data } = await supabase
    .from("attendance")
    .select("lesson_sessions!inner(session_date, classes!inner(tenant_id))")
    .eq("status", "holiday")
    .eq("lesson_sessions.classes.tenant_id", tenant);
  return (data ?? []) as unknown as { lesson_sessions: { session_date: string } | null }[];
}

/** Void every lesson on the date. Returns [count, errorMessage]. */
export async function markDayHoliday(
  tenant: string,
  date: string
): Promise<{ count: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc("mark_day_holiday", { p_tenant: tenant, p_date: date });
  return { count: (data as number | null) ?? null, error: error?.message ?? null };
}

export async function unmarkDayHoliday(
  tenant: string,
  date: string
): Promise<{ count: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc("unmark_day_holiday", { p_tenant: tenant, p_date: date });
  return { count: (data as number | null) ?? null, error: error?.message ?? null };
}

export async function saveExtensionDays(tenant: string, clamped: number): Promise<string | null> {
  const { error } = await supabase
    .from("tenants")
    .update({ holiday_extension_days: clamped })
    .eq("id", tenant);
  return error?.message ?? null;
}

/** Insert one holiday. Returns the error code (for the 23505 message) or null. */
export async function insertHoliday(
  tenant: string | null,
  date: string,
  name: string
): Promise<{ code: string | null; error: string | null }> {
  const { error } = await supabase
    .from("tenant_public_holidays")
    .insert({ tenant_id: tenant, holiday_date: date, name });
  return { code: error?.code ?? null, error: error?.message ?? null };
}

export async function deleteHoliday(id: string): Promise<string | null> {
  const { error } = await supabase.from("tenant_public_holidays").delete().eq("id", id);
  return error?.message ?? null;
}

/** Upsert imported rows. Returns [added, errorMessage]. */
export async function upsertHolidays(
  rows: { tenant_id: string | null; holiday_date: string; name: string }[]
): Promise<{ count: number | null; error: string | null }> {
  const { error, count } = await supabase
    .from("tenant_public_holidays")
    .upsert(rows, { onConflict: "tenant_id,holiday_date", count: "exact" });
  return { count: count ?? null, error: error?.message ?? null };
}
