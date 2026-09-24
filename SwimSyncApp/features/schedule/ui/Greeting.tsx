// The greeting and the long-form SGT date.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { greetingFor } from "@/lib/timeOfDay";
import type { useWeek } from "../domain/useWeek";
import type { useScheduleLoad } from "../domain/useScheduleLoad";

type Week = ReturnType<typeof useWeek>;
type Load = ReturnType<typeof useScheduleLoad>;

export function Greeting(p: Pick<Load, "session"> & Pick<Week, "todayStr" | "nowMins">) {
  const { session, todayStr, nowMins } = p;
  return (
    <>
      {/* Greeting. The long-form SGT date is also the cheapest possible proof
          that this screen's date is the Singapore one, and verify-tz-saturday
          asserts on it (§7.7). */}
      <View className="mb-4">
        <Text className="text-gray-500 text-sm">{greetingFor(nowMins)},</Text>
        <Text className="text-2xl font-bold text-gray-900">
          Coach {session?.fullName ?? "—"}
        </Text>
        <Text className="text-sm text-gray-400 mt-0.5">{todayStr}</Text>
      </View>
    </>
  );
}
