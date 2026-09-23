// One card per payout: its period, status and total, the lesson count, and any
// correction to an already-paid month.
// Moved VERBATIM from app/(coach)/pay/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// app fence) — the one block of the route that reads lib/payoutBreakdown, which a
// fenced route may not import. Props destructured on the first line so the JSX is
// byte-identical (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
import {
  breakdownFor,
  describeAdjustment,
  describeLessons,
  formatPeriod,
} from "@/lib/payoutBreakdown";
import type { useMyPay } from "../domain/useMyPay";

type Pay = ReturnType<typeof useMyPay>;

export function PayoutCards(p: Pick<Pay, "myPayouts" | "breakdowns">) {
  const { myPayouts, breakdowns } = p;
  return (
    <>
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
  );
}
