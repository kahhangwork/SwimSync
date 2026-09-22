// The marking screen's header: back chevron, title, and the Set all toggle.
// Moved VERBATIM from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6); props destructured on the first line so
// the JSX is byte-identical (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { StudentRow } from "../types";
import { formatDate } from "../domain/attendanceStatus";

export default function AttendanceHeader(p: {
  readOnly: boolean;
  classTitle: string;
  date: string;
  students: StudentRow[];
  menuOpen: boolean;
  setMenuOpen: (f: (v: boolean) => boolean) => void;
  leaveScreen: () => void;
}) {
  const { readOnly, classTitle, date, students, menuOpen, setMenuOpen, leaveScreen } = p;
  return (
    <>
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => leaveScreen()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {readOnly ? "Lesson Attendance" : "Mark Attendance"}
          </Text>
          <Text className="text-xs text-gray-500">
            {classTitle} · {formatDate(date)}
          </Text>
        </View>
        {students.length > 0 && !readOnly && (
          <TouchableOpacity
            onPress={() => setMenuOpen((v) => !v)}
            className="flex-row items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5"
          >
            <Text className="text-xs font-semibold text-sky-600">Set all</Text>
            <Ionicons
              name={menuOpen ? "chevron-up" : "chevron-down"}
              size={14}
              color="#0ea5e9"
            />
          </TouchableOpacity>
        )}
      </View>
    </>
  );
}
