// The Billing title.
// Moved from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-G);
// DESIGN.md type in UI restyle step 3.1.
import React from "react";
import { View, Text } from "react-native";

export function Header() {
  return (
    <View className="px-5 pt-6 pb-4">
      <Text className="text-display font-semibold text-ink">Billing</Text>
      <Text className="text-body-secondary text-ink-secondary mt-0.5">
        Invoices and credit notes
      </Text>
    </View>
  );
}
