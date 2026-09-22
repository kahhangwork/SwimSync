// The week selector — prev / range / next.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { canGoBack, canGoForward } from "@/lib/scheduleWeek";
import { shortDate } from "../domain/scheduleFormat";
import type { useWeek } from "../domain/useWeek";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Week = ReturnType<typeof useWeek>;
type Sections = ReturnType<typeof useScheduleSections>;

export function WeekSelector(p: Pick<Week, "weekOffset" | "setWeekOffset" | "weekStart" | "weekEnd" | "label"> & Pick<Sections, "bounds">) {
  const { weekOffset, setWeekOffset, weekStart, weekEnd, label, bounds } = p;
  return (
    <>
      {/* ── WEEK SELECTOR ───────────────────────────────────────────────── */}
      <View className="flex-row items-center justify-between mb-4 bg-white rounded-2xl px-2 py-2 border border-gray-100">
        {/* testIDs because these are ICON-ONLY controls — there is no text
            for a driver to grab, and a positional click is exactly the
            brittleness §7.10/§7.58 punish. They render as data-testid on
            RN-web, so Playwright's getByTestId finds them. */}
        <TouchableOpacity
          testID="week-prev"
          disabled={!canGoBack(weekOffset, bounds.min)}
          onPress={() => setWeekOffset((w) => w - 1)}
          className="px-3 py-1.5"
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={canGoBack(weekOffset, bounds.min) ? "#0ea5e9" : "#d1d5db"}
          />
        </TouchableOpacity>

        <View className="items-center">
          <Text className="text-sm font-semibold text-gray-900">
            {shortDate(weekStart)} – {shortDate(weekEnd)}
          </Text>
          {label !== "" && (
            <Text className="text-xs text-sky-600">{label}</Text>
          )}
        </View>

        <TouchableOpacity
          testID="week-next"
          disabled={!canGoForward(weekOffset, bounds.max)}
          onPress={() => setWeekOffset((w) => w + 1)}
          className="px-3 py-1.5"
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={canGoForward(weekOffset, bounds.max) ? "#0ea5e9" : "#d1d5db"}
          />
        </TouchableOpacity>
      </View>
    </>
  );
}
