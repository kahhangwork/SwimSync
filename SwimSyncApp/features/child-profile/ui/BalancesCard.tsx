// Balances — outstanding, credit, and how this child's lessons are paid.
// Moved VERBATIM from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import Card from "@/components/Card";
import { describeCoverage, type StudentCoverage } from "@/lib/packageCoverage";
import type { ChildDetail } from "../types";

export function BalancesCard(p: { child: ChildDetail; coverage: StudentCoverage | undefined }) {
  const { child, coverage } = p;
  return (
    <>
      {/* Balances */}
      <Card>
        <Text className="text-base font-bold text-gray-900 mb-3">Balances</Text>
        <View className="flex-row gap-3">
          <View className="flex-1 bg-red-50 rounded-xl p-3 items-center">
            <Text className="text-xs text-red-500 mb-1">Outstanding</Text>
            <Text className="text-xl font-bold text-red-600">
              S${child.outstanding_amount.toFixed(2)}
            </Text>
          </View>
          <View className="flex-1 bg-blue-50 rounded-xl p-3 items-center">
            <Text className="text-xs text-blue-500 mb-1">Credit Balance</Text>
            <Text className="text-xl font-bold text-blue-600">
              S${child.credit_balance.toFixed(2)}
            </Text>
          </View>
        </View>
        {/* How this child's lessons are paid — package (with the family's
            live count) or ad-hoc invoice. Absent only if the RPC failed. */}
        {describeCoverage(coverage) && (
          <View
            className={`mt-3 rounded-xl p-3 ${
              coverage?.coverage === "ad_hoc" ? "bg-gray-50" : "bg-emerald-50"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                coverage?.coverage === "ad_hoc"
                  ? "text-gray-500"
                  : "text-emerald-700"
              }`}
            >
              {describeCoverage(coverage)}
            </Text>
          </View>
        )}
      </Card>
    </>
  );
}
