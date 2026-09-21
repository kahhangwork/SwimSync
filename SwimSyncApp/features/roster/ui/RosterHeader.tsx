// RosterHeader — the roster screen's header (back + title) (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Markup moved VERBATIM from app/(coach)/classes/[id]/roster.tsx: the props are
// destructured on the first line so the JSX below is byte-identical to the
// route's (playbook §2). Nothing here may import dao/ (fence check 1).
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
    <>
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {classInfo?.title ?? "Class"}
          </Text>
          <Text className="text-xs text-gray-500">
            {capitalize(classInfo?.day_of_week ?? "")} ·{" "}
            {formatTime(classInfo?.start_time ?? "")} –{" "}
            {formatTime(classInfo?.end_time ?? "")}
          </Text>
        </View>
      </View>

    </>
  );
}
