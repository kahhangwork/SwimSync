// Postgres function calls for the Wages page. ⚠ ORCHESTRATE, NEVER REPLACE:
// each wrapper passes its argument object THROUGH to supabase.rpc and computes
// nothing. generate_coach_payouts rebuilds DRAFT payouts and never touches PAID
// ones; mark_payout_paid freezes a month deliberately and irreversibly. This
// layer must not pre-empt, default, or reshape either. Every args type is
// hand-written with all keys REQUIRED, and asserted against the generated Args
// so a renamed param is a compile error (§7.345).
import { supabase } from "@/lib/supabase";
import type { Assert, Extends, Rpc } from "@/lib/database.overrides";

export type GenerateCoachPayoutsArgs = {
  p_tenant_id: string;
  p_period_month: string;
};
type _CheckGenerate = Assert<Extends<GenerateCoachPayoutsArgs, Rpc<"generate_coach_payouts">["Args"]>>;
export function generateCoachPayouts(args: GenerateCoachPayoutsArgs) {
  return supabase.rpc("generate_coach_payouts", args);
}

export type MarkPayoutPaidArgs = { p_payout_id: string };
type _CheckMarkPaid = Assert<Extends<MarkPayoutPaidArgs, Rpc<"mark_payout_paid">["Args"]>>;
export function markPayoutPaid(args: MarkPayoutPaidArgs) {
  return supabase.rpc("mark_payout_paid", args);
}
