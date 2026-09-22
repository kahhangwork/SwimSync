// The one-tap return to this week.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { useWeek } from "../domain/useWeek";

type Week = ReturnType<typeof useWeek>;

export function BackToThisWeek(p: Pick<Week, "weekOffset" | "setWeekOffset">) {
  const { weekOffset, setWeekOffset } = p;
  return (
    <>
      {/* One tap back to the present. Marking a straggler correctly returns
          the coach to that past week, which is right for the straggler and
          wrong as a resting state. */}
      {weekOffset !== 0 && (
        <TouchableOpacity
          testID="week-today"
          onPress={() => setWeekOffset(0)}
          className="mb-4 self-start flex-row items-center gap-1"
        >
          <Ionicons name="today-outline" size={14} color="#0ea5e9" />
          <Text className="text-xs font-semibold text-sky-600">
            Back to this week
          </Text>
        </TouchableOpacity>
      )}
    </>
  );
}
