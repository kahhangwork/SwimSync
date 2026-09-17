// Postgres function calls for the Wages page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. generate_coach_payouts rebuilds DRAFT payouts and never touches PAID
// ones; mark_payout_paid freezes a month deliberately and irreversibly. This
// layer must not pre-empt, default, or reshape either. The admin client is
// untyped, so every args type has all keys REQUIRED.
import { supabase } from "@/lib/supabase";

export type GenerateCoachPayoutsArgs = {
  p_tenant_id: string;
  p_period_month: string;
};
export function generateCoachPayouts(args: GenerateCoachPayoutsArgs) {
  return supabase.rpc("generate_coach_payouts", args);
}

export type MarkPayoutPaidArgs = { p_payout_id: string };
export function markPayoutPaid(args: MarkPayoutPaidArgs) {
  return supabase.rpc("mark_payout_paid", args);
}
