import React, { useEffect } from "react";
import { SafeAreaView, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import { useAttendanceLoad } from "@/features/mark-attendance/domain/useAttendanceLoad";
import { useSaveAttendance } from "@/features/mark-attendance/domain/useSaveAttendance";
import { useMarking } from "@/features/mark-attendance/domain/useMarking";
import { exitHrefOf } from "@/features/mark-attendance/domain/exitHref";
import { isShowingDate, roleView } from "@/features/mark-attendance/domain/screenState";
import AttendanceLoading from "@/features/mark-attendance/ui/AttendanceLoading";
import BlockedLesson from "@/features/mark-attendance/ui/BlockedLesson";
import AttendanceHeader from "@/features/mark-attendance/ui/AttendanceHeader";
import RoleNotice from "@/features/mark-attendance/ui/RoleNotice";
import StudentMarkList from "@/features/mark-attendance/ui/StudentMarkList";
import CoachesPresent from "@/features/mark-attendance/ui/CoachesPresent";
import SetAllMenu from "@/features/mark-attendance/ui/SetAllMenu";

export default function MarkAttendanceScreen() {
  const { id } = useLocalSearchParams<{
    id: string;
    date: string;
  }>();
  // ⚠ THERE IS DELIBERATELY NO `sessionId` PARAM ANY MORE. This screen used to
  // accept one from the URL and trust it, without checking that it belonged to
  // this class or to the date on screen. Supplying a real session id satisfied
  // the "this session already exists" branch, which SKIPS the weekday check —
  // so the screen rendered a markable roster for a date it should have refused.
  // Never a billing hole (records attach to the session that id names, and the
  // database guard reads that session's OWN date, so every write stayed inside
  // the window), but the header could show a date the records did not belong
  // to. The session is now always resolved from `(class_id, date)`, which is
  // UNIQUE — `lesson_sessions` carries `ON CONFLICT (class_id, session_date)`
  // (20260727000100) — so the lookup cannot disagree with what a caller would
  // have passed, and there is nothing left to trust.
  const { date, from } = useLocalSearchParams<{
    date: string;
    from?: string;
  }>();

  // Where leaving goes — the §7.65 rule and its ⚠ default-arm note live with
  // exitHrefOf (features/mark-attendance/domain/exitHref.ts).
  const exitHref = exitHrefOf(from, id);

  function leaveScreen() {
    router.replace(exitHref as any);
  }

  const {
    classTitle,
    students,
    attendance,
    setAttendance,
    loadedStatuses,
    resolved,
    setResolved,
    loading,
    blocked,
    shadowsHere,
    setShadowsHere,
    role,
    load,
  } = useAttendanceLoad(id, date);
  const { saving, handleSave } = useSaveAttendance({
    id,
    date,
    students,
    attendance,
    resolved,
    setResolved,
    shadowsHere,
    loadedStatuses,
    leaveScreen,
  });
  const { menuOpen, setMenuOpen, setTop, setSub, onSetAll } = useMarking(
    students,
    attendance,
    setAttendance
  );

  // ⚠ THESE DEPS ARE LOAD-BEARING — this was `[]`, and it wrote attendance to
  // the wrong day (§7.64). One route serves every lesson, distinguished only
  // by `?date=`, and Expo Router reuses the mounted screen when a search param
  // changes. A mount-only effect therefore never reloads, so the header showed
  // the new lesson over the previous lesson's roster and session id.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, date]);

  // The spinner also covers the gap between a param change and the reload
  // landing. The effect runs after paint, so without `isShowingDate` there is
  // a frame where the header names the new lesson above the previous one's
  // roster — and a tap is faster than a frame is long.
  if (loading || !isShowingDate(resolved, date)) {
    return <AttendanceLoading />;
  }

  // This date cannot be marked. Shown INSTEAD of the roster rather than as a
  // toast over it: a roster the coach can fill in but never save is worse than
  // no roster, and the reason belongs where the work would have happened.
  if (blocked && !blocked.ok) {
    return (
      <BlockedLesson
        classTitle={classTitle}
        date={date}
        blocked={blocked}
        leaveScreen={leaveScreen}
      />
    );
  }

  // A lesson I am shadowing, or one another coach was rostered to cover, is
  // READ-ONLY here — the database refuses my write either way. The roster still
  // renders: a trainee is on the poolside to learn who is expected, and a coach
  // whose lesson was covered is entitled to see what happened in their class.
  const { readOnly, notice } = roleView(role);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <AttendanceHeader
        readOnly={readOnly}
        classTitle={classTitle}
        date={date}
        students={students}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        leaveScreen={leaveScreen}
      />

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-3"
        showsVerticalScrollIndicator={false}
      >
        <RoleNotice notice={notice} />

        <StudentMarkList
          students={students}
          attendance={attendance}
          readOnly={readOnly}
          setTop={setTop}
          setSub={setSub}
        />

        <CoachesPresent
          readOnly={readOnly}
          shadowsHere={shadowsHere}
          setShadowsHere={setShadowsHere}
        />

        {/* No save button at all when the lesson is not mine to mark. A
            disabled one would still read as "this is my job, and it is
            broken"; its absence plus the notice above says whose job it is. */}
        {!readOnly && (
          <PrimaryButton
            label={saving ? "Saving…" : "Save Attendance"}
            onPress={handleSave}
            className="mt-2"
          />
        )}
      </ScrollView>

      {/* Set-all dropdown (rendered last so it stacks above the list) */}
      <SetAllMenu menuOpen={menuOpen} setMenuOpen={setMenuOpen} onSetAll={onSetAll} />
    </SafeAreaView>
  );
}
