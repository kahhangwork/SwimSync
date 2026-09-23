// The "different package?" line and the SwimSync footer.
// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text } from "react-native";

export function Footer() {
  return (
    <>
      <Text className="text-center text-sm text-gray-500 mb-2">
        Prefer a different package? Tell your coach.
      </Text>
      <Text className="text-center text-xs text-gray-400">
        SwimSync · Swim attendance & billing
      </Text>
    </>
  );
}
