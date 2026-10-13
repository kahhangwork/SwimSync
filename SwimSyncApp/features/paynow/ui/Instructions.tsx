// The numbered payment instructions.
// Moved from app/(parent)/billing/paynow.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); DESIGN.md in UI restyle step 3.3.
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import type { usePayNow } from "../domain/usePayNow";

type PayNow = ReturnType<typeof usePayNow>;

export function Instructions(p: Pick<PayNow, "unconfigured" | "showPayableId" | "reference" | "dynamicQr">) {
  const { unconfigured, showPayableId, reference, dynamicQr } = p;
  if (unconfigured) return null;
  return (
    <Surface className="w-full">
      <Text className="text-headline font-semibold text-ink mb-3">
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
          <View className="w-6 h-6 rounded-tag border border-border bg-ground items-center justify-center">
            <Text className="text-label font-semibold text-ink-secondary">{i + 1}</Text>
          </View>
          <Text className="text-body text-ink flex-1">{step}</Text>
        </View>
      ))}
    </Surface>
  );
}
