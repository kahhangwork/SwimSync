// The location filter chips — only when the coach teaches at more than one.
// Moved VERBATIM from app/(coach)/classes/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
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
          className="mb-4 -mx-1 px-1"
        >
          {[{ id: "", name: "All locations" }, ...locationOpts].map((opt) => {
            const active = effLocationFilter === opt.id;
            return (
              <TouchableOpacity
                key={opt.id || "all"}
                onPress={() => setLocationFilter(opt.id)}
                activeOpacity={0.8}
                className={`rounded-full px-4 py-1.5 ${
                  active ? "bg-sky-600" : "bg-white border border-gray-200"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    active ? "text-white" : "text-gray-600"
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
