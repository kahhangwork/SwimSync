// The coach My Pay tab's load (docs/refactor/BATCH_FGH_PLAN.md, app fence) — moved
// VERBATIM from app/(coach)/pay/index.tsx, builders now dao calls. loadData keeps
// its deps ([]); the route's useFocusEffect is keyed on it. The ⚠ truncation rule
// (a capped response shows NO breakdown, not a short one) is unchanged.
import { useState, useCallback } from "react";
import {
  parsePayoutItems,
  breakdownByPayout,
  type PayoutBreakdown,
} from "@/lib/payoutBreakdown";
import { ITEM_LIMIT } from "../constants";
import { fetchMyPayouts, fetchPayoutItems } from "../dao/coachPay.repo";
import type { MyPayout } from "../types";

export function useMyPay() {
  const [myPayouts, setMyPayouts] = useState<MyPayout[]>([]);
  const [breakdowns, setBreakdowns] = useState<Map<string, PayoutBreakdown>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);

    // RLS returns only THIS coach's payouts (coach_payouts_select scopes to
    // current_coach_id()), so no filter is needed here — and a colleague's pay
    // is not reachable even by asking for it.
    const { data: payoutRows } = await fetchMyPayouts();

    const payouts = (payoutRows ?? []).map((p: any) => ({
      id: p.id,
      period_month: p.period_month,
      gross_amount: Number(p.gross_amount),
      status: p.status,
    }));
    setMyPayouts(payouts);

    // ── AND WHAT THE MONTH IS MADE OF ───────────────────────────────────────
    // A total on its own stopped being self-explanatory when a lesson could be
    // covered: a correction to a month that was already PAID lands here, on a
    // later payout, and moves the number with nothing on screen accounting for
    // it (the plan's §1.6 — "invisible from every screen"). `is_adjustment` and
    // `original_period` have carried the answer since 20260719000400; nobody
    // was reading them. Same RLS as the payout itself, so this asks for nothing
    // a coach could not already see.
    const { data: itemRows } =
      payouts.length > 0
        ? await fetchPayoutItems(payouts.map((p) => p.id))
        : { data: [] as any[] };
    // ⚠ A TRUNCATED RESPONSE MEANS NO BREAKDOWN AT ALL, NOT A SHORT ONE.
    // PostgREST caps every response and does it silently, and these lines are
    // the numbers a coach checks their total AGAINST — "11 lessons" under a
    // total covering twelve is worse than saying nothing, because it reads as
    // the business having miscounted the coach's month.
    const rows = itemRows ?? [];
    setBreakdowns(
      rows.length >= ITEM_LIMIT ? new Map() : breakdownByPayout(parsePayoutItems(rows))
    );

    setLoading(false);
  }, []);

  const totalPaid = myPayouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.gross_amount, 0);

  return {
    myPayouts,
    breakdowns,
    loading,
    loadData,
    totalPaid,
  };
}
