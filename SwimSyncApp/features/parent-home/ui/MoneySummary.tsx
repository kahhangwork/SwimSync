// The outstanding-payment and credit-balance cards.
// Moved VERBATIM from app/(parent)/home/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
import type { useParentHome } from "../domain/useParentHome";

type Home = ReturnType<typeof useParentHome>;

export function MoneySummary(p: Pick<Home, "totalOutstanding" | "creditBalance">) {
  const { totalOutstanding, creditBalance } = p;
  return (
    <>
      {/* Outstanding summary */}
      {totalOutstanding > 0 && (
        <Card className="mb-5 bg-red-50 border-red-100">
          <View className="flex-row items-center gap-2 mb-1">
            <Ionicons name="alert-circle" size={18} color="#dc2626" />
            <Text className="text-red-600 font-semibold text-sm">
              Outstanding Payment
            </Text>
          </View>
          <Text className="text-2xl font-bold text-red-700">
            S${totalOutstanding.toFixed(2)}
          </Text>
          <Text className="text-xs text-red-500 mt-0.5">
            Across all children — tap an invoice to pay
          </Text>
        </Card>
      )}

      {/* Credit balance */}
      {creditBalance > 0 && (
        <Card className="mb-5 bg-blue-50 border-blue-100">
          <View className="flex-row items-center gap-2 mb-1">
            <Ionicons name="wallet-outline" size={18} color="#2563eb" />
            <Text className="text-blue-600 font-semibold text-sm">
              Credit Balance
            </Text>
          </View>
          <Text className="text-2xl font-bold text-blue-700">
            S${creditBalance.toFixed(2)}
          </Text>
          <Text className="text-xs text-blue-500 mt-0.5">
            Will be applied to your next invoice automatically
          </Text>
        </Card>
      )}
    </>
  );
}
