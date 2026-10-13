// The Attendance title.
// Moved from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); DESIGN.md type in UI restyle step 3.7.
import React from "react";
import { View, Text } from "react-native";

export function Header() {
  return (
    <View className="px-5 pt-6 pb-4">
      <Text className="text-display font-semibold text-ink">Attendance</Text>
      <Text className="text-body-secondary text-ink-secondary mt-0.5">
        Upcoming lessons and history for your children
      </Text>
    </View>
  );
}
