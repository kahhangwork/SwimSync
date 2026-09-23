// The status filter chips.
// Moved VERBATIM from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
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
            className={`px-3 py-1.5 rounded-full border ${
              filter === opt
                ? "bg-gray-900 border-gray-900"
                : "bg-white border-gray-200"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                filter === opt ? "text-white" : "text-gray-500"
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
