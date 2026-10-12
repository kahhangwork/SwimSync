// The empty-week card.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SURFACE } from "@/components/ui/Surface";
import type { useWeek } from "../domain/useWeek";
import type { useScheduleLoad } from "../domain/useScheduleLoad";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Week = ReturnType<typeof useWeek>;
type Load = ReturnType<typeof useScheduleLoad>;
type Sections = ReturnType<typeof useScheduleSections>;

export function EmptyWeek(p: Pick<Load, "weekLessons"> & Pick<Sections, "visibleNeedsMarking"> & Pick<Week, "showsTodaySection">) {
  const { weekLessons, visibleNeedsMarking, showsTodaySection } = p;
  return (
    <>
      {/* Only when there is no TODAY section to carry its own
          "No lessons today." line — otherwise an empty current week
          printed two empty states one above the other. */}
      {weekLessons.length === 0 &&
        visibleNeedsMarking.length === 0 &&
        !showsTodaySection && (
        <View className={`${SURFACE} items-center py-10`}>
          <Ionicons name="sunny-outline" size={40} color="#d4d4d4" />
          <Text className="text-body text-ink-secondary mt-3">
            No lessons this week
          </Text>
        </View>
      )}
    </>
  );
}
