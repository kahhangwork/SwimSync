// One label/value row of the profile and class cards.
// Moved VERBATIM from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F), where it was a module-level component below the screen.
import React from "react";
import { View, Text } from "react-native";

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1.5 border-b border-gray-50">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm font-medium text-gray-800 max-w-[60%] text-right">
        {value}
      </Text>
    </View>
  );
}
