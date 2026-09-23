// The My Classes title.
// Moved VERBATIM from app/(coach)/classes/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";

export function Heading() {
  return (
    <>
      <View className="mb-6">
        <Text className="text-2xl font-bold text-gray-900">My Classes</Text>
        <Text className="text-sm text-gray-500 mt-0.5">
          All assigned classes
        </Text>
      </View>
    </>
  );
}
