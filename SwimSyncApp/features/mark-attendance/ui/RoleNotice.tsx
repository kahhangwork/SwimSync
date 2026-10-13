// Whose lesson this is (shadow / covered), or the plain instruction.
// Moved from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6); restyled in UI restyle step 2.2.
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
        // Info: waiting on someone else — the main coach records it.
        <View className="rounded-card border border-status-info-border bg-status-info-bg p-4">
          <View className="flex-row items-center gap-2">
            <Ionicons name="eye-outline" size={16} color="#1e40af" />
            <Text className="text-body font-semibold text-status-info-text">
              {notice.title}
            </Text>
          </View>
          <Text className="text-body-secondary text-ink mt-1">
            {notice.detail}
          </Text>
        </View>
      ) : (
        <Text className="text-body-secondary text-ink-secondary">
          Tap a status for each student
        </Text>
      )}
    </>
  );
}
