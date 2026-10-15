// The outstanding-payment and credit-balance cards.
// Moved from app/(parent)/home/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-F).
// UI restyle step 3.4: an unpaid bill is DUE, not stuck — a Warning container,
// never red (DESIGN.md's Red Means Stuck Rule); its show/hide condition is
// unchanged (plan ⚠ RISK 2). The credit card is a plain Surface. Amounts in Ink,
// tabular, exactly the hook's figures. MoneySummary.test reaches each card as the
// title's second host ancestor — keep title → icon row → card.
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import type { useParentHome } from "../domain/useParentHome";
import { formatSgd } from "@/lib/money";

type Home = ReturnType<typeof useParentHome>;

const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function MoneySummary(p: Pick<Home, "totalOutstanding" | "creditBalance">) {
  const { totalOutstanding, creditBalance } = p;
  return (
    <>
      {/* Outstanding summary */}
      {totalOutstanding > 0 && (
        <View className="mb-3 rounded-card border p-4 bg-status-warning-bg border-status-warning-border">
          <View className="flex-row items-center gap-2 mb-1">
            <Ionicons name="time-outline" size={18} color="#92400e" />
            <Text className="text-body font-semibold text-status-warning-text">
              Outstanding Payment
            </Text>
          </View>
          <Text className="text-display font-semibold text-ink" style={TABULAR}>
            {formatSgd(totalOutstanding)}
          </Text>
          <Text className="text-body-secondary text-ink-secondary mt-0.5">
            Across all children — tap an invoice to pay
          </Text>
        </View>
      )}

      {/* Credit balance */}
      {creditBalance > 0 && (
        <Surface className="mb-3">
          <View className="flex-row items-center gap-2 mb-1">
            <Ionicons name="wallet-outline" size={18} color="#525252" />
            <Text className="text-body font-semibold text-ink-secondary">
              Credit Balance
            </Text>
          </View>
          <Text className="text-display font-semibold text-ink" style={TABULAR}>
            {formatSgd(creditBalance)}
          </Text>
          <Text className="text-body-secondary text-ink-secondary mt-0.5">
            Will be applied to your next invoice automatically
          </Text>
        </Surface>
      )}
    </>
  );
}
