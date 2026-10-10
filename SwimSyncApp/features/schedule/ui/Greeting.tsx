// The greeting and the long-form SGT date.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { greetingFor } from "@/lib/timeOfDay";
import { coachTitle } from "../domain/scheduleFormat";
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
      <View className="mb-5">
        <Text className="text-body-secondary text-ink-secondary">{greetingFor(nowMins)},</Text>
        <Text className="text-display font-semibold text-ink">
          {coachTitle(session?.fullName)}
        </Text>
        <Text className="text-body-secondary text-ink-secondary mt-0.5">{todayStr}</Text>
      </View>
    </>
  );
}
