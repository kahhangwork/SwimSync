// One label/value row of the profile and class cards.
// Moved from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); DESIGN.md in UI restyle step 3.5.
import React from "react";
import { View, Text } from "react-native";

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-3 py-2 border-b border-divider">
      <Text className="text-body text-ink-secondary">{label}</Text>
      <Text className="text-body font-medium text-ink max-w-[60%] text-right">
        {value}
      </Text>
    </View>
  );
}
