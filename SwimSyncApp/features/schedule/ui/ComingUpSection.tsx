// COMING UP.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { DaySection } from "./DaySection";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Sections = ReturnType<typeof useScheduleSections>;

export function ComingUpSection(p: Pick<Sections, "buckets" | "expandedDays" | "toggleDay" | "openAttendance">) {
  const { buckets, expandedDays, toggleDay, openAttendance } = p;
  return (
    <>
      {/* ── COMING UP ─────────────────────────────────────────────── */}
      {buckets.comingUp.length > 0 && (
        <View className="mb-6">
          <Text className="text-lg font-bold text-gray-900 mb-2">
            COMING UP
          </Text>
          {buckets.comingUp.map((g) => (
            <DaySection
              key={g.date}
              group={g}
              tappable={false}
              open={expandedDays.has(g.date)}
              onToggle={toggleDay}
              onOpenLesson={openAttendance}
            />
          ))}
        </View>
      )}
    </>
  );
}
