// Postgres function calls for the Referrals page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. The RPCs enforce the real rules (admin-gating; void refused on a
// claimed package — RISK 6); this layer must not pre-empt, default, or reshape
// them. Every args type is hand-written with all keys REQUIRED, and asserted
// against the generated Args so a renamed param is a compile error (§7.345).
import { supabase } from "@/lib/supabase";
import type { Assert, Extends, Rpc } from "@/lib/database.overrides";

export type SetReferralCodeDisabledArgs = {
  p_parent_tenant_id: string;
  p_disabled: boolean;
};
type _CheckSetCodeDisabled = Assert<Extends<SetReferralCodeDisabledArgs, Rpc<"set_referral_code_disabled">["Args"]>>;
export function setReferralCodeDisabled(args: SetReferralCodeDisabledArgs) {
  return supabase.rpc("set_referral_code_disabled", args);
}

export type GrantReferralRewardArgs = { p_parent_id: string; p_reason: string };
type _CheckGrantReward = Assert<Extends<GrantReferralRewardArgs, Rpc<"grant_referral_reward">["Args"]>>;
export function grantReferralReward(args: GrantReferralRewardArgs) {
  return supabase.rpc("grant_referral_reward", args);
}

export type VoidReferralRewardArgs = { p_reward_id: string; p_reason: string };
type _CheckVoidReward = Assert<Extends<VoidReferralRewardArgs, Rpc<"void_referral_reward">["Args"]>>;
export function voidReferralReward(args: VoidReferralRewardArgs) {
  return supabase.rpc("void_referral_reward", args);
}
