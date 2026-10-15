// The location filter chips.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text, ScrollView, TouchableOpacity } from "react-native";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Sections = ReturnType<typeof useScheduleSections>;

export function LocationChips(p: Pick<Sections, "scheduleLocationOpts" | "effLocationFilter" | "setLocationFilter">) {
  const { scheduleLocationOpts, effLocationFilter, setLocationFilter } = p;
  return (
    <>
      {/* Location filter — only when this coach's week spans more than one.
          Filters the week's sections; NEEDS MARKING deliberately ignores it. */}
      {scheduleLocationOpts.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 pb-1"
          className="mb-5 -mx-1 px-1"
        >
          {[{ id: "", name: "All locations" }, ...scheduleLocationOpts].map((opt) => {
            const active = effLocationFilter === opt.id;
            return (
              <TouchableOpacity
                key={opt.id || "all"}
                onPress={() => setLocationFilter(opt.id)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                aria-pressed={active}
                // DESIGN.md: the selected segment is the Selected fill — not a
                // second blue — and words, not shade alone, carry the choice.
                className={`min-h-11 justify-center rounded-control border px-3.5 ${
                  active ? "bg-selected border-border-strong" : "bg-surface border-border"
                }`}
              >
                <Text
                  className={`text-body ${
                    active ? "font-semibold text-ink" : "font-medium text-ink-secondary"
                  }`}
                >
                  {opt.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </>
  );
}
