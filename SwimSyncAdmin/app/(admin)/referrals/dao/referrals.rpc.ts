// Postgres function calls for the Referrals page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. The RPCs enforce the real rules (admin-gating; void refused on a
// claimed package — RISK 6); this layer must not pre-empt, default, or reshape
// them. The admin client is untyped, so every args type has all keys REQUIRED.
import { supabase } from "@/lib/supabase";

export type SetReferralCodeDisabledArgs = {
  p_parent_tenant_id: string;
  p_disabled: boolean;
};
export function setReferralCodeDisabled(args: SetReferralCodeDisabledArgs) {
  return supabase.rpc("set_referral_code_disabled", args);
}

export type GrantReferralRewardArgs = { p_parent_id: string; p_reason: string };
export function grantReferralReward(args: GrantReferralRewardArgs) {
  return supabase.rpc("grant_referral_reward", args);
}

export type VoidReferralRewardArgs = { p_reward_id: string; p_reason: string };
export function voidReferralReward(args: VoidReferralRewardArgs) {
  return supabase.rpc("void_referral_reward", args);
}
