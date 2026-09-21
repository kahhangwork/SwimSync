import React, { useCallback } from "react";
import { ScrollView, SafeAreaView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { useRosterData } from "@/features/roster/domain/useRosterData";
import { useRemoveStudent } from "@/features/roster/domain/useRemoveStudent";
import { useOpenLevel } from "@/features/roster/domain/useOpenLevel";
import { RosterHeader } from "@/features/roster/ui/RosterHeader";
import { MarkTargetPanel } from "@/features/roster/ui/MarkTargetPanel";
import { UpcomingGuests } from "@/features/roster/ui/UpcomingGuests";
import { StudentList } from "@/features/roster/ui/StudentList";
import { PastSessions } from "@/features/roster/ui/PastSessions";

// The coach's class roster: composition only (COACH_ROSTER_REFACTOR_PLAN.md).
// State and load live in features/roster/domain, queries in …/dao, markup in
// …/ui. The one effect is here: useFocusEffect re-runs the load on every focus,
// keyed on loadData's identity — which is why the hook returns it unwrapped.
export default function ClassRosterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    classInfo,
    students,
    upcomingTrials,
    upcomingMakeups,
    upcomingExtras,
    sessions,
    markTarget,
    windowStart,
    loading,
    duplicateNames,
    todayDate,
    loadData,
  } = useRosterData(id);
  const { removingId, handleRemove } = useRemoveStudent(id, loadData);
  const { openLevelFor, setOpenLevelFor } = useOpenLevel();

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <RosterHeader classInfo={classInfo} />
      <ScrollView
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <MarkTargetPanel id={id} markTarget={markTarget} todayDate={todayDate} windowStart={windowStart} students={students} />
        <UpcomingGuests upcomingTrials={upcomingTrials} upcomingMakeups={upcomingMakeups} upcomingExtras={upcomingExtras} />
        <StudentList id={id} students={students} duplicateNames={duplicateNames} removingId={removingId} handleRemove={handleRemove} openLevelFor={openLevelFor} setOpenLevelFor={setOpenLevelFor} />
        <PastSessions id={id} sessions={sessions} />
      </ScrollView>
    </SafeAreaView>
  );
}
