// Every read the coach My Pay tab makes (docs/refactor/BATCH_FGH_PLAN.md, app fence)
// — only ever this coach's OWN pay (RLS: coach_payouts_select). Raw builders,
// byte-identical to the chains they replaced in app/(coach)/pay/index.tsx.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";
import { ITEM_LIMIT } from "../constants";

export const fetchMyPayouts = () =>
  supabase
    .from("coach_payouts")
    .select("id, period_month, gross_amount, status")
    .order("period_month", { ascending: false })
    .limit(12);

export const fetchPayoutItems = (payoutIds: string[]) =>
  supabase
    .from("coach_payout_items")
    .select("payout_id, class_title, session_date, amount, is_adjustment, original_period")
    .in(
      "payout_id",
      payoutIds
    )
    .limit(ITEM_LIMIT);
