// Balances — outstanding, credit, and how this child's lessons are paid.
// Moved from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-F).
// UI restyle step 3.5: amounts in Ink, tabular. Nothing owed is not an alarm — the
// Outstanding box is a Warning tint only while something is owed (it was red even
// at S$0.00), never red (DESIGN.md: Red Means Stuck). The figures are the child's
// own, printed as-is. BalancesCard.test reads each amount from inside the box its
// label sits in — keep label → box.
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import { describeCoverage, type StudentCoverage } from "@/lib/packageCoverage";
import type { ChildDetail } from "../types";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function BalancesCard(p: { child: ChildDetail; coverage: StudentCoverage | undefined }) {
  const { child, coverage } = p;
  const firstName = child.full_name.split(" ")[0];
  const owing = child.outstanding_amount > 0;
  return (
    <Surface>
      <Text className="text-headline font-semibold text-ink mb-3">Balances</Text>
      <View className="flex-row gap-3">
        <View
          className={`flex-1 rounded-control border p-3 ${
            owing
              ? "bg-status-warning-bg border-status-warning-border"
              : "bg-ground border-border"
          }`}
        >
          <Text
            className={`text-label font-medium mb-1 ${
              owing ? "text-status-warning-text" : "text-ink-secondary"
            }`}
          >
            Outstanding
          </Text>
          <Text className="text-headline font-semibold text-ink" style={TABULAR}>
            S${child.outstanding_amount.toFixed(2)}
          </Text>
        </View>
        <View className="flex-1 rounded-control border p-3 bg-ground border-border">
          <Text className="text-label font-medium text-ink-secondary mb-1">Credit Balance</Text>
          <Text className="text-headline font-semibold text-ink" style={TABULAR}>
            S${child.credit_balance.toFixed(2)}
          </Text>
        </View>
      </View>
      {/* How this child's lessons are paid — package (with the family's
          live count) or ad-hoc invoice. Absent only if the RPC failed. */}
      {describeCoverage(coverage, firstName) && (
        <View className="mt-3 rounded-control border border-border bg-ground p-3">
          <Text className="text-body-secondary text-ink">
            {describeCoverage(coverage, firstName)}
          </Text>
        </View>
      )}
    </Surface>
  );
}
