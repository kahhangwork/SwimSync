// Loading package….
// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text, View } from "react-native";

export function LoadingView() {
  return (
    <>
      <View className="flex-1 bg-sky-50 items-center justify-center">
        <Text className="text-gray-500">Loading package…</Text>
      </View>
    </>
  );
}
