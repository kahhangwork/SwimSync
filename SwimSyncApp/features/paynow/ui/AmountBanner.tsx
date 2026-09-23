// The amount to pay, with the billing month or package name.
// Moved VERBATIM from app/(parent)/billing/paynow.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import type { usePayNow } from "../domain/usePayNow";

type PayNow = ReturnType<typeof usePayNow>;

export function AmountBanner(p: Pick<PayNow, "netAmount" | "billingMonth" | "packageName">) {
  const { netAmount, billingMonth, packageName } = p;
  return (
    <>
      {/* Amount banner */}
      {netAmount !== null && (
        <View className="w-full bg-red-50 border border-red-100 rounded-2xl p-4 mb-6 items-center">
          <Text className="text-sm text-red-500 mb-1">Amount to Pay</Text>
          <Text className="text-3xl font-bold text-red-600">
            S${netAmount.toFixed(2)}
          </Text>
          {billingMonth && (
            <Text className="text-xs text-red-400 mt-1">{billingMonth}</Text>
          )}
          {packageName && (
            <Text className="text-xs text-red-400 mt-1">{packageName}</Text>
          )}
        </View>
      )}
    </>
  );
}
