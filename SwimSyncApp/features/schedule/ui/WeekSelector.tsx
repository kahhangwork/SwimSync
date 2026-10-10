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
      <View className="flex-row items-center justify-between mb-3 bg-surface border border-border rounded-card px-1 py-1">
        {/* testIDs because these are ICON-ONLY controls — there is no text
            for a driver to grab, and a positional click is exactly the
            brittleness §7.10/§7.58 punish. They render as data-testid on
            RN-web, so Playwright's getByTestId finds them. */}
        <TouchableOpacity
          testID="week-prev"
          disabled={!canGoBack(weekOffset, bounds.min)}
          onPress={() => setWeekOffset((w) => w - 1)}
          className="w-11 h-11 items-center justify-center"
          // A label but NO button role: with that role RN-web renders a real
          // <button disabled> at the bound, and Playwright refuses to click it —
          // verify-schedule-week presses past the bound on purpose to prove it
          // does not move.
          accessibilityLabel="Previous week"
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={canGoBack(weekOffset, bounds.min) ? "#525252" : "#d4d4d4"}
          />
        </TouchableOpacity>

        <View className="items-center">
          <Text className="text-body font-semibold text-ink">
            {shortDate(weekStart)} – {shortDate(weekEnd)}
          </Text>
          {label !== "" && (
            <Text className="text-label text-ink-secondary">{label}</Text>
          )}
        </View>

        <TouchableOpacity
          testID="week-next"
          disabled={!canGoForward(weekOffset, bounds.max)}
          onPress={() => setWeekOffset((w) => w + 1)}
          className="w-11 h-11 items-center justify-center"
          accessibilityLabel="Next week"
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={canGoForward(weekOffset, bounds.max) ? "#525252" : "#d4d4d4"}
          />
        </TouchableOpacity>
      </View>
    </>
  );
}
