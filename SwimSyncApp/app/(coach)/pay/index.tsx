import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import {
  parsePayoutItems,
  breakdownByPayout,
  breakdownFor,
  describeAdjustment,
  describeLessons,
  formatPeriod,
  type PayoutBreakdown,
} from "@/lib/payoutBreakdown";
import Card from "@/components/Card";

// ⚠ THIS SCREEN DELIBERATELY SHOWS NO INVOICES.
//
// Until 2026-08-02 it was a full invoice list with Outstanding/Paid counts, a
// filter and a Mark Paid button — written before payment collection existed
// (PRD §7.21). Everything that makes an invoice actionable now lives on the
// admin panel: the `INV-YYYY-NNNN` reference, the dynamic PayNow QR, the
// WhatsApp reminder queue, the "parent says paid" badge and the Claimed
// filter. A second, poorer invoice list on the coach's phone is not a
// convenience — it is a place to make a money decision with less information
// than the admin panel would have given.
//
// Mark-paid is gone for the same reason. The one converged path,
// `confirm_invoice_paid()` (audit row included), is now reached only from the
// admin panel and the public invoice page. Do not re-add a caller here.
//
// What remains is the one billing fact that is genuinely the coach's own and
// has nowhere else to live: what they are paid.

/** What this coach is owed. Read-only, and only ever their OWN — a colleague's
 *  earnings must not be inferable. RLS scopes it to their coaches.id. */
type MyPayout = {
  id: string;
  period_month: string;
  gross_amount: number;
  status: "draft" | "paid";
};

/** Twelve months of payouts, and their items bounded below PostgREST's silent
 *  `max_rows` ceiling — the same discipline the Schedule tab's ROW_LIMIT
 *  encodes, for the same reason. */
const ITEM_LIMIT = 900;

export default function CoachPayScreen() {
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
    const { data: payoutRows } = await supabase
      .from("coach_payouts")
      .select("id, period_month, gross_amount, status")
      .order("period_month", { ascending: false })
      .limit(12);

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
        ? await supabase
            .from("coach_payout_items")
            .select("payout_id, class_title, session_date, amount, is_adjustment, original_period")
            .in(
              "payout_id",
              payouts.map((p) => p.id)
            )
            .limit(ITEM_LIMIT)
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

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const totalPaid = myPayouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.gross_amount, 0);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-5">
          <Text className="text-2xl font-bold text-gray-900">My Pay</Text>
          <Text className="text-sm text-gray-500 mt-0.5">
            What you&apos;re paid for teaching
          </Text>
        </View>

        {loading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : myPayouts.length === 0 ? (
          // Reachable only in a narrow window — the tab is hidden entirely
          // until a payout exists (lib/useCoachHasPayouts.ts) — but a payout
          // can be removed while the app is open, and a blank screen reads as
          // broken.
          <View className="items-center py-16">
            <Ionicons name="wallet-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 text-center px-8">
              No pay periods yet. Your business&apos;s admin prepares these.
            </Text>
          </View>
        ) : (
          <>
            {totalPaid > 0 && (
              <View className="bg-green-50 rounded-2xl p-4 border border-green-100 items-center mb-5">
                <Text className="text-xs text-green-500">Paid to you so far</Text>
                <Text className="text-2xl font-bold text-green-600 mt-0.5">
                  S${totalPaid.toFixed(2)}
                </Text>
              </View>
            )}

            <Text className="text-sm font-semibold text-gray-900 mb-2">
              Your pay
            </Text>
            <View className="gap-3">
              {myPayouts.map((p) => {
                const b = breakdownFor(breakdowns, p.id);
                return (
                  <Card key={p.id}>
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="text-base font-bold text-gray-900">
                          {formatPeriod(p.period_month)}
                        </Text>
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {p.status === "paid"
                            ? "Paid"
                            : "Draft — may still change until it's paid"}
                        </Text>
                      </View>
                      <Text
                        className={`text-lg font-bold ${
                          p.status === "paid" ? "text-green-600" : "text-gray-900"
                        }`}
                      >
                        S${p.gross_amount.toFixed(2)}
                      </Text>
                    </View>

                    {/* The lesson count is not decoration: it is the fact a
                        coach checks the total against. A month that gained a
                        covered lesson shows one more than the month before. */}
                    {b.lessons > 0 && (
                      <Text className="text-xs text-gray-400 mt-2">
                        {describeLessons(b.lessons)} · S$
                        {b.lessonTotal.toFixed(2)}
                      </Text>
                    )}

                    {/* ⚠ A CORRECTION IS THE ONE LINE THIS SCREEN CANNOT LEAVE
                        OUT. It is money for a month that has already been paid
                        — the coach cannot reconcile it against the lessons they
                        remember teaching THIS month, and until Wave 3 nothing
                        anywhere told them it existed. */}
                    {b.adjustments.map((a) => (
                      <View
                        key={a.period ?? "unknown"}
                        className="flex-row items-center gap-1.5 mt-1.5 rounded-xl bg-violet-50 px-2.5 py-1.5"
                      >
                        <Ionicons
                          name="swap-horizontal-outline"
                          size={13}
                          color="#6d28d9"
                        />
                        <Text className="text-xs text-violet-800 flex-1">
                          Includes {describeAdjustment(a)}
                        </Text>
                      </View>
                    ))}
                  </Card>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
