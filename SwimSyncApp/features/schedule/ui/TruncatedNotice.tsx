// The row-limit warning.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text } from "react-native";
import Card from "@/components/Card";
import type { useScheduleLoad } from "../domain/useScheduleLoad";

type Load = ReturnType<typeof useScheduleLoad>;

export function TruncatedNotice(p: Pick<Load, "truncated">) {
  const { truncated } = p;
  return (
    <>
      {truncated && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <Text className="text-sm font-semibold text-amber-800">
            Too many lessons to check at once
          </Text>
          <Text className="text-xs text-amber-700 mt-1">
            This list may be incomplete. Ask your admin before relying on it to
            tell you what still needs marking.
          </Text>
        </Card>
      )}
    </>
  );
}
