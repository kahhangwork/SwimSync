// ← Back.
// Moved VERBATIM from app/(auth)/register.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";

export function BackLink() {
  return (
    <>
      {/* Header */}
      <TouchableOpacity onPress={() => router.back()} className="mb-6">
        <Text className="text-sky-500 text-base">← Back</Text>
      </TouchableOpacity>
    </>
  );
}
