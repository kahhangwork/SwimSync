// One card per payout: its period, status and total, the lesson count, and any
// correction to an already-paid month.
// Moved from app/(coach)/pay/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, app fence) —
// the one block of the route that reads lib/payoutBreakdown, which a fenced route may
// not import. Restyled in UI restyle step 2.6: amounts in Ink with tabular figures,
// the payout's state a status tag. Every figure is the breakdown's — nothing is
// recomputed here.
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { Tag } from "@/components/ui/Tag";
import {
  breakdownFor,
  describeAdjustment,
  describeLessons,
  formatPeriod,
} from "@/lib/payoutBreakdown";
import type { useMyPay } from "../domain/useMyPay";

type Pay = ReturnType<typeof useMyPay>;

const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function PayoutCards(p: Pick<Pay, "myPayouts" | "breakdowns">) {
  const { myPayouts, breakdowns } = p;
  return (
    <View className="gap-3">
      {myPayouts.map((p) => {
        const b = breakdownFor(breakdowns, p.id);
        const paid = p.status === "paid";
        return (
          <Surface key={p.id}>
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-headline font-semibold text-ink">
                  {formatPeriod(p.period_month)}
                </Text>
                <Tag label={paid ? "Paid" : "Draft"} tone={paid ? "success" : "neutral"} />
              </View>
              <Text className="text-headline font-semibold text-ink" style={TABULAR}>
                S${p.gross_amount.toFixed(2)}
              </Text>
            </View>
            {!paid && (
              <Text className="text-body-secondary text-ink-secondary mt-2">
                May still change until it&apos;s paid.
              </Text>
            )}

            {/* The lesson count is not decoration: it is the fact a
                coach checks the total against. A month that gained a
                covered lesson shows one more than the month before. */}
            {b.lessons > 0 && (
              <Text className="text-body-secondary text-ink-secondary mt-2" style={TABULAR}>
                {describeLessons(b.lessons)} · S$
                {b.lessonTotal.toFixed(2)}
              </Text>
            )}

            {/* ⚠ A CORRECTION IS THE ONE LINE THIS SCREEN CANNOT LEAVE
                OUT. It is money for a month that has already been paid
                — the coach cannot reconcile it against the lessons they
                remember teaching THIS month, and until Wave 3 nothing
                anywhere told them it existed. Info: it explains, it asks
                nothing of the coach. */}
            {b.adjustments.map((a) => (
              <View
                key={a.period ?? "unknown"}
                className="flex-row items-center gap-1.5 mt-2 rounded-control border border-status-info-border bg-status-info-bg px-2.5 py-1.5"
              >
                <Ionicons name="swap-horizontal-outline" size={14} color="#1e40af" />
                <Text className="text-body-secondary text-status-info-text flex-1">
                  Includes {describeAdjustment(a)}
                </Text>
              </View>
            ))}
          </Surface>
        );
      })}
    </View>
  );
}
