import { useCallback } from "react";
import { View, ScrollView, SafeAreaView, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { useWeek } from "@/features/schedule/domain/useWeek";
import { useScheduleLoad } from "@/features/schedule/domain/useScheduleLoad";
import { useScheduleSections } from "@/features/schedule/domain/useScheduleSections";
import { Greeting } from "@/features/schedule/ui/Greeting";
import { WeekSelector } from "@/features/schedule/ui/WeekSelector";
import { LocationChips } from "@/features/schedule/ui/LocationChips";
import { BackToThisWeek } from "@/features/schedule/ui/BackToThisWeek";
import { TruncatedNotice } from "@/features/schedule/ui/TruncatedNotice";
import { NeedsMarkingSection } from "@/features/schedule/ui/NeedsMarkingSection";
import { TodaySection } from "@/features/schedule/ui/TodaySection";
import { ComingUpSection } from "@/features/schedule/ui/ComingUpSection";
import { DoneSection } from "@/features/schedule/ui/DoneSection";
import { EmptyWeek } from "@/features/schedule/ui/EmptyWeek";

// The coach's Schedule tab — the landing tab: composition only
// (COACH_SCHEDULE_REFACTOR_PLAN.md). The week lives in features/schedule/domain/useWeek,
// the load in …/useScheduleLoad (queries in …/dao, the pure per-class loop in
// …/scheduleRows), the sections in …/useScheduleSections, markup in …/ui. The one
// effect is here: useFocusEffect re-runs the load on every focus, keyed on
// loadData's identity — which is why the hook returns its useCallback unwrapped.
export default function ScheduleScreen() {
  const {
    weekOffset,
    setWeekOffset,
    todayDate,
    nowMins,
    todayStr,
    weekStart,
    weekEnd,
    showsTodaySection,
    label,
  } = useWeek();
  const { session, needsMarking, weekLessons, floor, truncated, loading, loadData } =
    useScheduleLoad({ weekOffset, todayDate, nowMins, weekStart, weekEnd });

  const {
    bounds,
    setLocationFilter,
    expandedDays,
    visibleNeedsMarking,
    scheduleLocationOpts,
    effLocationFilter,
    buckets,
    todayLessons,
    todayStudents,
    todayGuests,
    toggleDay,
    openAttendance,
  } = useScheduleSections({ todayDate, showsTodaySection, needsMarking, weekLessons, floor });

  // ⚠ ONE EFFECT, NOT TWO. `useFocusEffect` re-runs whenever its callback
  // identity changes WHILE FOCUSED, and `loadData` is rebuilt on every
  // `weekOffset` change — so it already covers pressing an arrow. An extra
  // `useEffect(..., [loadData])` beside it is not a safety net, it is a second
  // full four-query round on every mount and every arrow press.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <Greeting session={session} todayStr={todayStr} nowMins={nowMins} />

        <WeekSelector weekOffset={weekOffset} setWeekOffset={setWeekOffset} weekStart={weekStart} weekEnd={weekEnd} label={label} bounds={bounds} />

        <LocationChips scheduleLocationOpts={scheduleLocationOpts} effLocationFilter={effLocationFilter} setLocationFilter={setLocationFilter} />

        <BackToThisWeek weekOffset={weekOffset} setWeekOffset={setWeekOffset} />

        <TruncatedNotice truncated={truncated} />

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : (
          <>
            <NeedsMarkingSection visibleNeedsMarking={visibleNeedsMarking} openAttendance={openAttendance} />

            <TodaySection showsTodaySection={showsTodaySection} todayDate={todayDate} nowMins={nowMins} todayLessons={todayLessons} todayStudents={todayStudents} todayGuests={todayGuests} openAttendance={openAttendance} />

            <ComingUpSection buckets={buckets} expandedDays={expandedDays} toggleDay={toggleDay} openAttendance={openAttendance} />

            <DoneSection buckets={buckets} expandedDays={expandedDays} toggleDay={toggleDay} openAttendance={openAttendance} />

            <EmptyWeek weekLessons={weekLessons} visibleNeedsMarking={visibleNeedsMarking} showsTodaySection={showsTodaySection} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
