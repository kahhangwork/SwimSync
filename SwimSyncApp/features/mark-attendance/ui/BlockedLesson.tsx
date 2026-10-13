// This date cannot be marked — shown INSTEAD of the roster.
// Moved from app/(coach)/classes/[id]/attendance.tsx (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stage 6); restyled in UI restyle step 2.2.
import React from "react";
import { View, Text, TouchableOpacity, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";
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
    <SafeAreaView className="flex-1 bg-ground">
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity
          onPress={() => leaveScreen()}
          accessibilityLabel="Back"
          className="w-11 h-11 -ml-3 items-center justify-center"
        >
          <Ionicons name="chevron-back" size={24} color="#0a0a0a" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-display font-semibold text-ink">
            Mark Attendance
          </Text>
          <Text className="text-body-secondary text-ink-secondary">
            {classTitle} · {formatDate(date)}
          </Text>
        </View>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="lock-closed-outline" size={44} color="#6b6b6b" />
        <Text className="text-headline font-semibold text-ink mt-3 text-center">
          {blocked.title}
        </Text>
        <Text className="text-body text-ink-secondary mt-2 text-center">
          {blocked.detail}
        </Text>
        <Button label="Back to class" onPress={() => leaveScreen()} className="mt-6" />
      </View>
    </SafeAreaView>
  );
}
