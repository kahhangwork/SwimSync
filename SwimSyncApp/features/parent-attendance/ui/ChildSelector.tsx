// One chip per child (first name), or a spinner while children load.
// Moved VERBATIM from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
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
          <ActivityIndicator size="small" color="#0ea5e9" />
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
              className={`px-4 py-2 rounded-full border ${
                selectedChildId === child.id
                  ? "bg-sky-500 border-sky-500"
                  : "bg-white border-gray-200"
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  selectedChildId === child.id ? "text-white" : "text-gray-600"
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
