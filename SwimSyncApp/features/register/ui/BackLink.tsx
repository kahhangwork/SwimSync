// ← Back.
// Moved VERBATIM from app/(auth)/register.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside). Restyled in UI restyle step 4.3: a 44px Lane Blue link (the
// height is the Text's padding, so the router line is untouched).
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";

export function BackLink() {
  return (
    <>
      {/* Header */}
      <TouchableOpacity onPress={() => router.back()} className="mb-6">
        <Text className="py-3 self-start text-body font-medium text-primary">← Back</Text>
      </TouchableOpacity>
    </>
  );
}
