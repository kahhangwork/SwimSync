// The Attendance title.
// Moved VERBATIM from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";

export function Header() {
  return (
    <>
      {/* Header */}
      <View className="px-5 pt-5 pb-3">
        <Text className="text-2xl font-bold text-gray-900">Attendance</Text>
        <Text className="text-sm text-gray-500 mt-0.5">
          Upcoming lessons and history for your children
        </Text>
      </View>
    </>
  );
}
