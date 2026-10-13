// The spinner shown while a lesson loads (and, today, forever for a cancelled one — plan §6 Stage 3).
// Moved from app/(coach)/classes/[id]/attendance.tsx (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stage 6); restyled in UI restyle step 2.2.
import React from "react";
import { SafeAreaView, ActivityIndicator } from "react-native";

export default function AttendanceLoading() {
  return (
    <SafeAreaView className="flex-1 bg-ground items-center justify-center">
      <ActivityIndicator size="large" color="#2563eb" />
    </SafeAreaView>
  );
}
