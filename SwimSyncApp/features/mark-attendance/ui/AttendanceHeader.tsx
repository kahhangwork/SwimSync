// The marking screen's header: back chevron, title, and the lesson line.
// Moved from app/(coach)/classes/[id]/attendance.tsx (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stage 6). UI restyle step 2.2 moved "Set all" out of here to the bottom action
// area (AttendanceActions), within a thumb's reach beside Save.
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatDate } from "../domain/attendanceStatus";

export default function AttendanceHeader(p: {
  readOnly: boolean;
  classTitle: string;
  date: string;
  leaveScreen: () => void;
}) {
  const { readOnly, classTitle, date, leaveScreen } = p;
  return (
    <View className="flex-row items-center px-5 pt-4 pb-3">
      <TouchableOpacity
        onPress={() => leaveScreen()}
        accessibilityLabel="Back"
        className="w-11 h-11 -ml-3 items-center justify-center"
      >
        <Ionicons name="chevron-back" size={24} color="#0a0a0a" />
      </TouchableOpacity>
      <View className="flex-1">
        {/* The title is its own leaf: verify-coach-marking reads it as a whole
            line (`(^|\n)Mark Attendance\n`). */}
        <Text className="text-display font-semibold text-ink">
          {readOnly ? "Lesson Attendance" : "Mark Attendance"}
        </Text>
        <Text className="text-body-secondary text-ink-secondary">
          {classTitle} · {formatDate(date)}
        </Text>
      </View>
    </View>
  );
}
