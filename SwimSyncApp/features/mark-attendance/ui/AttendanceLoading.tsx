// The spinner shown while a lesson loads (and, today, forever for a cancelled one — plan §6 Stage 3).
// Moved VERBATIM from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6).
import React from "react";
import { SafeAreaView, ActivityIndicator } from "react-native";

export default function AttendanceLoading() {
  return (
    <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
      <ActivityIndicator size="large" color="#0ea5e9" />
    </SafeAreaView>
  );
}
