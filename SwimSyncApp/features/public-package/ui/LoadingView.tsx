// Loading package….
// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside). Restyled in UI restyle step 4.6 (Ground, Ink Secondary).
import React from "react";
import { Text, View } from "react-native";

export function LoadingView() {
  return (
    <>
      <View className="flex-1 bg-ground items-center justify-center">
        <Text className="text-body text-ink-secondary">Loading package…</Text>
      </View>
    </>
  );
}
