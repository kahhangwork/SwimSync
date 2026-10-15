// One chip per child (first name), or a spinner while children load.
// Moved from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). UI restyle step 3.7: 44px chips, 6px corners, the chosen child the
// Selected fill (DESIGN.md — not a second blue).
import React from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import type { useParentAttendance } from "../domain/useParentAttendance";

type Att = ReturnType<typeof useParentAttendance>;

export function ChildSelector(p: Pick<Att, "loadingChildren" | "children" | "selectedChildId" | "setSelectedChildId">) {
  const { loadingChildren, children, selectedChildId, setSelectedChildId } = p;
  return (
    <>
      {/* Child selector */}
      {loadingChildren ? (
        <View className="px-5 mb-3">
          <ActivityIndicator size="small" color="#2563eb" />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // flex-grow-0: react-native-web gives every ScrollView flexGrow:1, so a
          // horizontal one expands to fill the column's leftover height. items-start:
          // the row content container would otherwise stretch each chip to that
          // height (RN's default alignItems is stretch). Together they keep the
          // chips their natural size on web; native was never affected.
          className="flex-grow-0"
          contentContainerClassName="px-5 gap-2 mb-3 items-start"
        >
          {children.map((child) => (
            <TouchableOpacity
              key={child.id}
              onPress={() => setSelectedChildId(child.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedChildId === child.id }}
              aria-pressed={selectedChildId === child.id}
              className={`min-h-11 px-4 justify-center rounded-control border ${
                selectedChildId === child.id
                  ? "bg-selected border-border-strong"
                  : "bg-surface border-border"
              }`}
            >
              <Text
                className={`text-body ${
                  selectedChildId === child.id ? "font-semibold text-ink" : "font-medium text-ink-secondary"
                }`}
              >
                {child.full_name.split(" ")[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </>
  );
}
