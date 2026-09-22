// This date cannot be marked — shown INSTEAD of the roster.
// Moved VERBATIM from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6); props destructured on the first line so
// the JSX is byte-identical (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MarkableCheck } from "@/lib/attendanceWindow";
import { formatDate } from "../domain/attendanceStatus";

export default function BlockedLesson(p: {
  classTitle: string;
  date: string;
  blocked: Extract<MarkableCheck, { ok: false }>;
  leaveScreen: () => void;
}) {
  const { classTitle, date, blocked, leaveScreen } = p;
  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => leaveScreen()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            Mark Attendance
          </Text>
          <Text className="text-xs text-gray-500">
            {classTitle} · {formatDate(date)}
          </Text>
        </View>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="lock-closed-outline" size={44} color="#cbd5e1" />
        <Text className="text-base font-bold text-gray-900 mt-3 text-center">
          {blocked.title}
        </Text>
        <Text className="text-sm text-gray-500 mt-2 text-center leading-5">
          {blocked.detail}
        </Text>
        <TouchableOpacity
          onPress={() => leaveScreen()}
          className="mt-6 px-5 py-3 rounded-xl bg-sky-500"
        >
          <Text className="text-white font-semibold">Back to class</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
