// The location filter chips — only when the coach teaches at more than one.
// Moved from app/(coach)/classes/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-H);
// restyled in UI restyle step 2.3 to match the Schedule tab's chips.
import React from "react";
import { Text, ScrollView, TouchableOpacity } from "react-native";
import type { useCoachClasses } from "../domain/useCoachClasses";

type Classes = ReturnType<typeof useCoachClasses>;

export function LocationChips(p: Pick<Classes, "locationOpts" | "effLocationFilter" | "setLocationFilter">) {
  const { locationOpts, effLocationFilter, setLocationFilter } = p;
  return (
    <>
      {locationOpts.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 pb-1"
          className="mb-5 -mx-1 px-1"
        >
          {[{ id: "", name: "All locations" }, ...locationOpts].map((opt) => {
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
