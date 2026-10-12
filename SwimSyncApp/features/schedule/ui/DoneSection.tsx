// DONE.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { DaySection } from "./DaySection";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Sections = ReturnType<typeof useScheduleSections>;

export function DoneSection(p: Pick<Sections, "buckets" | "expandedDays" | "toggleDay" | "openAttendance">) {
  const { buckets, expandedDays, toggleDay, openAttendance } = p;
  return (
    <>
      {/* ── DONE ──────────────────────────────────────────────────── */}
      {buckets.done.length > 0 && (
        <View className="mb-5">
          <Text className="text-label font-semibold text-ink-muted mb-1">Done</Text>
          {buckets.done.map((g) => (
            <DaySection
              key={g.date}
              group={g}
              tappable={true}
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
