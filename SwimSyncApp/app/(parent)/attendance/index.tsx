import React, { useCallback } from "react";
import { ScrollView, SafeAreaView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useParentAttendance } from "@/features/parent-attendance/domain/useParentAttendance";
import { Header } from "@/features/parent-attendance/ui/Header";
import { ChildSelector } from "@/features/parent-attendance/ui/ChildSelector";
import { FilterChips } from "@/features/parent-attendance/ui/FilterChips";
import { UpcomingSection } from "@/features/parent-attendance/ui/UpcomingSection";
import { HistoryList } from "@/features/parent-attendance/ui/HistoryList";

// The parent Attendance tab — composition only (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). State and both loads live in
// features/parent-attendance/domain/useParentAttendance (queries in …/dao, the row
// mappings in …/attendanceFormat, the projection in …/upcomingLessons), markup in
// …/ui.
//
// ⚠ TWO FOCUS EFFECTS, IN THE ORIGINAL ORDER — children first, then attendance —
// each keyed on its loader's identity (plan ⚠ R4).
export default function AttendanceScreen() {
  const {
    children,
    selectedChildId,
    setSelectedChildId,
    records,
    filter,
    setFilter,
    loadingChildren,
    loadingRecords,
    hasExpectedLesson,
    upcoming,
    loadChildren,
    loadAttendance,
    selectedChild,
    filtered,
  } = useParentAttendance();

  // Load the parent's children once on focus
  useFocusEffect(
    useCallback(() => {
      loadChildren();
    }, [loadChildren])
  );

  // Load attendance whenever selected child changes
  useFocusEffect(
    useCallback(() => {
      loadAttendance();
    }, [loadAttendance])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <Header />

      <ChildSelector loadingChildren={loadingChildren} children={children} selectedChildId={selectedChildId} setSelectedChildId={setSelectedChildId} />

      <FilterChips filter={filter} setFilter={setFilter} />

      {/* Attendance list */}
      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-2"
        showsVerticalScrollIndicator={false}
      >
        <UpcomingSection loadingRecords={loadingRecords} selectedChild={selectedChild} upcoming={upcoming} records={records} />

        <HistoryList loadingRecords={loadingRecords} children={children} selectedChild={selectedChild} records={records} hasExpectedLesson={hasExpectedLesson} filtered={filtered} filter={filter} />
      </ScrollView>
    </SafeAreaView>
  );
}
