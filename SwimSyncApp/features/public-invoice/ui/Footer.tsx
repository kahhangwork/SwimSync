// The SwimSync footer line.
// Moved VERBATIM from app/invoice/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text } from "react-native";

export function Footer() {
  return (
    <>
      <Text className="text-center text-xs text-gray-400">
        SwimSync · Swim attendance & billing
      </Text>
    </>
  );
}
