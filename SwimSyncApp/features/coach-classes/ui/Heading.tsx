// The My Classes title.
// Moved from app/(coach)/classes/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-H);
// restyled in UI restyle step 2.3.
import React from "react";
import { View, Text } from "react-native";

export function Heading() {
  return (
    <View className="mb-5">
      <Text className="text-display font-semibold text-ink">My Classes</Text>
      <Text className="text-body-secondary text-ink-secondary mt-0.5">
        All assigned classes
      </Text>
    </View>
  );
}
