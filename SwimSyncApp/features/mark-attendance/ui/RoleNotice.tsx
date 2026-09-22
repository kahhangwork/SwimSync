// Whose lesson this is (shadow / covered), or the plain instruction.
// Moved VERBATIM from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6); props destructured on the first line so
// the JSX is byte-identical (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { roleNotice } from "@/lib/coachRoster";

export default function RoleNotice(p: { notice: ReturnType<typeof roleNotice> }) {
  const { notice } = p;
  return (
    <>
      {notice ? (
        // Said where the work would have happened, exactly like `blocked`
        // above — and unlike `blocked` the roster still follows it, because
        // seeing who is expected is the whole reason a shadow is here.
        <View className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <View className="flex-row items-center gap-2">
            <Ionicons name="eye-outline" size={16} color="#6d28d9" />
            <Text className="text-sm font-bold text-violet-900">
              {notice.title}
            </Text>
          </View>
          <Text className="text-xs text-violet-800 mt-1 leading-5">
            {notice.detail}
          </Text>
        </View>
      ) : (
        <Text className="text-sm text-gray-500 mb-1">
          Tap a status for each student
        </Text>
      )}
    </>
  );
}
