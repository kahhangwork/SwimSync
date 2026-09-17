// Data access for the Referrals page — every PostgREST read/write, as thin
// functions returning the raw builder ({ data, error } awaited by the caller).
// No mapping, no logic: row -> entity mapping lives in domain/referralRows.ts,
// orchestration (Promise.all, reload after a write) in domain/useReferrals.ts.
import { supabase } from "@/lib/supabase";
import type { Settings } from "../types";

export async function myTenantId(): Promise<string | null> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data } = await supabase
    .from("profiles").select("tenant_id").eq("id", user.user.id).single();
  return (data?.tenant_id as string | null) ?? null;
}

export function loadSettings(t: string) {
  return supabase.from("tenants")
    .select("referral_enabled, referral_discount_type, referral_discount_value, referral_reward_expiry_days")
    .eq("id", t).single();
}

export function loadMemberships(t: string) {
  return supabase.from("parent_tenants")
    .select("id, parent_id, referral_code, referral_code_disabled_at, parents(profiles(full_name))")
    .eq("tenant_id", t);
}

export function loadReferrals(t: string) {
  return supabase.from("referrals")
    .select("id, referrer_parent_id, referee_parent_id, status, void_reason, created_at, converted_at")
    .eq("tenant_id", t).order("created_at", { ascending: false });
}

export function loadRewards(t: string) {
  return supabase.from("referral_rewards")
    .select("id, parent_id, kind, status, earned_at, expires_at, void_reason")
    .eq("tenant_id", t).order("earned_at", { ascending: false });
}

/** Every key REQUIRED — the admin client is untyped, so a dropped key would
 *  typecheck and silently leave a setting unsaved. */
export function saveSettings(tenant: string, settings: Settings) {
  return supabase.from("tenants").update({
    referral_enabled: settings.referral_enabled,
    referral_discount_type: settings.referral_discount_type,
    referral_discount_value: settings.referral_discount_value,
    referral_reward_expiry_days: settings.referral_reward_expiry_days,
  }).eq("id", tenant);
}
