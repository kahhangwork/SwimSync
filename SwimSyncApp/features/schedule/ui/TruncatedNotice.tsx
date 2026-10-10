// The row-limit warning.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import type { useScheduleLoad } from "../domain/useScheduleLoad";

type Load = ReturnType<typeof useScheduleLoad>;

export function TruncatedNotice(p: Pick<Load, "truncated">) {
  const { truncated } = p;
  return (
    <>
      {truncated && (
        <View className="mb-5 bg-status-warning-bg border border-status-warning-border rounded-card p-4">
          <Text className="text-body font-semibold text-status-warning-text">
            Too many lessons to check at once
          </Text>
          <Text className="text-body-secondary text-status-warning-text mt-1">
            This list may be incomplete. Ask your admin before relying on it to
            tell you what still needs marking.
          </Text>
        </View>
      )}
    </>
  );
}
