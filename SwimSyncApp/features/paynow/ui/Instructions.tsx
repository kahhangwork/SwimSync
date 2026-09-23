// The numbered payment instructions.
// Moved VERBATIM from app/(parent)/billing/paynow.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import type { usePayNow } from "../domain/usePayNow";

type PayNow = ReturnType<typeof usePayNow>;

export function Instructions(p: Pick<PayNow, "unconfigured" | "showPayableId" | "reference" | "dynamicQr">) {
  const { unconfigured, showPayableId, reference, dynamicQr } = p;
  return (
    <>
      {/* Instructions */}
      {!unconfigured && (
        <View className="w-full bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <Text className="text-sm font-bold text-gray-900 mb-3">
            Payment Instructions
          </Text>
          {(showPayableId
            ? [
                "Open your banking app",
                "Tap PayNow, then Enter PayNow ID",
                "Enter the PayNow ID shown above",
                "Enter the exact amount shown",
                reference
                  ? `Put ${reference} in the reference or comments field`
                  : "Complete the transfer",
              ]
            : [
                "Open your banking app",
                "Tap Scan to Pay or QR",
                "Scan the QR code above",
                dynamicQr
                  ? "Check the amount matches this bill"
                  : "Enter the exact amount shown",
                "Complete the transfer",
              ]
          ).map((step, i) => (
            <View key={i} className="flex-row gap-3 mb-2 items-start">
              <View className="w-5 h-5 rounded-full bg-sky-100 items-center justify-center mt-0.5">
                <Text className="text-xs font-bold text-sky-600">{i + 1}</Text>
              </View>
              <Text className="text-sm text-gray-600 flex-1">{step}</Text>
            </View>
          ))}
        </View>
      )}
    </>
  );
}
