// The status filter chips.
// Moved from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). UI restyle step 3.7: 44px touch targets (were ~28px), 6px corners,
// the chosen filter the Selected fill. verify-parent-attendance holds a chip
// under 60px tall and wider than tall.
import React from "react";
import { Text, ScrollView, TouchableOpacity } from "react-native";
import { FILTER_OPTIONS } from "../constants";
import type { useParentAttendance } from "../domain/useParentAttendance";

type Att = ReturnType<typeof useParentAttendance>;

export function FilterChips(p: Pick<Att, "filter" | "setFilter">) {
  const { filter, setFilter } = p;
  return (
    <>
      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-grow-0"
        contentContainerClassName="px-5 gap-2 mb-4 items-start"
      >
        {FILTER_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt}
            onPress={() => setFilter(opt)}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === opt }}
            aria-pressed={filter === opt}
            className={`min-h-11 px-4 justify-center rounded-control border ${
              filter === opt
                ? "bg-selected border-border-strong"
                : "bg-surface border-border"
            }`}
          >
            <Text
              className={`text-body ${
                filter === opt ? "font-semibold text-ink" : "font-medium text-ink-secondary"
              }`}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </>
  );
}
