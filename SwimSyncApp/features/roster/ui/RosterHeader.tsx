// RosterHeader — the roster screen's header (back + title) (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Restyled in UI restyle step 2.4. Nothing here may import dao/ (fence check 1).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ClassInfo } from "@/features/roster/types";
import { formatTime, capitalize } from "@/features/roster/domain/rosterFormat";

export function RosterHeader(p: {
  classInfo: ClassInfo | null;
}) {
  const { classInfo } = p;
  return (
    <View className="flex-row items-center px-5 pt-4 pb-3">
      <TouchableOpacity
        onPress={() => router.back()}
        accessibilityLabel="Back"
        className="w-11 h-11 -ml-3 items-center justify-center"
      >
        <Ionicons name="chevron-back" size={24} color="#0a0a0a" />
      </TouchableOpacity>
      <View className="flex-1">
        <Text className="text-display font-semibold text-ink">
          {classInfo?.title ?? "Class"}
        </Text>
        <Text className="text-body-secondary text-ink-secondary">
          {capitalize(classInfo?.day_of_week ?? "")} ·{" "}
          {formatTime(classInfo?.start_time ?? "")} –{" "}
          {formatTime(classInfo?.end_time ?? "")}
        </Text>
      </View>
    </View>
  );
}
