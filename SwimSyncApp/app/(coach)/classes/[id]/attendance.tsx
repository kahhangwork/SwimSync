import React, { useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SET_ALL_OPTIONS } from "@/lib/attendanceBulk";
import {
  isShowingDate,
} from "@/lib/attendanceSession";
import {
  canMark,
  roleNotice,
} from "@/lib/coachRoster";
import PrimaryButton from "@/components/PrimaryButton";
import { TOP_STATUSES } from "@/features/mark-attendance/constants";
import { formatDate } from "@/features/mark-attendance/domain/attendanceStatus";
import { useAttendanceLoad } from "@/features/mark-attendance/domain/useAttendanceLoad";
import { useSaveAttendance } from "@/features/mark-attendance/domain/useSaveAttendance";
import { useMarking } from "@/features/mark-attendance/domain/useMarking";
import { exitHrefOf } from "@/features/mark-attendance/domain/exitHref";

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
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  // This date cannot be marked. Shown INSTEAD of the roster rather than as a
  // toast over it: a roster the coach can fill in but never save is worse than
  // no roster, and the reason belongs where the work would have happened.
  if (blocked && !blocked.ok) {
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

  // A lesson I am shadowing, or one another coach was rostered to cover, is
  // READ-ONLY here — the database refuses my write either way. The roster still
  // renders: a trainee is on the poolside to learn who is expected, and a coach
  // whose lesson was covered is entitled to see what happened in their class.
  const readOnly = !canMark(role);
  const notice = roleNotice(role);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
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

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-3"
        showsVerticalScrollIndicator={false}
      >
        {notice ? (
          // Said where the work would have happened, exactly like `blocked`
          // above — and unlike `blocked` the roster still follows it, because
          // seeing who is expected is the whole reason a shadow is here.
          <View className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <View className="flex-row items-center gap-2">
              <Ionicons name="eye-outline" size={16} color="#6d28d9" />
              <Text className="text-sm font-bold text-violet-900">
                {notice.title}
              </Text>
            </View>
            <Text className="text-xs text-violet-800 mt-1 leading-5">
              {notice.detail}
            </Text>
          </View>
        ) : (
          <Text className="text-sm text-gray-500 mb-1">
            Tap a status for each student
          </Text>
        )}

        {students.length === 0 ? (
          <View className="bg-white rounded-2xl p-6 items-center border border-gray-100">
            <Text className="text-gray-400 text-sm">No students enrolled</Text>
          </View>
        ) : (
          students.map((student) => {
            const state = attendance[student.id] ?? {
              top: "unmarked",
              sub: null,
            };
            return (
              <View
                key={student.id}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
              >
                {/* Student name */}
                <View className="flex-row items-center gap-3 mb-3">
                  <View className="w-9 h-9 rounded-full bg-sky-100 items-center justify-center">
                    <Text className="text-sky-600 font-bold text-sm">
                      {student.full_name.charAt(0)}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-gray-800">
                    {student.full_name}
                  </Text>
                  {student.attendedOnly && (
                    // Not a weekly regular — say which kind. A TRIAL is
                    // someone the coach is meeting for the first time and the
                    // status they pick decides what the family is charged; a
                    // MAKE-UP is an enrolled child guesting from another class
                    // for this one lesson.
                    <View
                      className={`px-2 py-0.5 rounded-full ${
                        student.isTrial
                          ? "bg-sky-100"
                          : student.isMakeup
                            ? "bg-emerald-100"
                            : "bg-amber-100"
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-semibold ${
                          student.isTrial
                            ? "text-sky-700"
                            : student.isMakeup
                              ? "text-emerald-700"
                              : "text-amber-700"
                        }`}
                      >
                        {student.isTrial
                          ? "Trial"
                          : student.isMakeup
                            ? "Make-up"
                            : "Not enrolled"}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Unmarked indicator */}
                {state.top === "unmarked" && (
                  <View className="flex-row items-center gap-1.5 mb-2">
                    <View className="w-2 h-2 rounded-full bg-gray-300" />
                    <Text className="text-xs text-gray-400 font-medium">
                      Not yet marked
                    </Text>
                  </View>
                )}

                {/* Public-holiday void — read-only. Set by the admin; a coach
                    cannot change it (the DB guard refuses), so no buttons show. */}
                {state.top === "holiday" && (
                  <View className="flex-row items-center gap-1.5 mb-1">
                    <View className="w-2 h-2 rounded-full bg-purple-400" />
                    <Text className="text-xs text-purple-500 font-medium">
                      Public holiday — no charge
                    </Text>
                  </View>
                )}

                {/* Top-level status buttons. A make-up guest gets the ordinary
                    statuses only: the trial statuses price by the trial rate,
                    and a make-up is not a trial. Affordance, not the guard —
                    the engine prices a mismark at the class rate. Hidden for a
                    holiday row, which is read-only. */}
                {state.top !== "holiday" && (
                <View className="flex-row gap-2">
                  {TOP_STATUSES.filter(
                    ({ key }) => !(student.isMakeup && key === "trial")
                  ).map(({ key, label, ring, bg }) => {
                    const isSelected = state.top === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        disabled={readOnly}
                        onPress={() => setTop(student.id, key)}
                        className={`flex-1 py-2 rounded-xl border-2 items-center ${
                          isSelected
                            ? `${ring} ${bg}`
                            : "border-gray-200 bg-gray-50"
                        } ${readOnly && !isSelected ? "opacity-50" : ""}`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            isSelected ? "text-white" : "text-gray-500"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                )}

                {/* Cancelled sub-type */}
                {state.top === "cancelled" && (
                  <View className="mt-3 flex-row gap-2 items-center">
                    <Text className="text-xs text-gray-500 mr-1">Reason:</Text>
                    {[
                      { key: "rain", label: "Rain" },
                      { key: "coach", label: "Coach" },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        disabled={readOnly}
                        onPress={() => setSub(student.id, key)}
                        className={`px-4 py-1.5 rounded-full border ${
                          state.sub === key
                            ? "bg-orange-500 border-orange-500"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            state.sub === key ? "text-white" : "text-gray-600"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Trial sub-type */}
                {state.top === "trial" && (
                  <View className="mt-3 flex-row gap-2 items-center">
                    <Text className="text-xs text-gray-500 mr-1">Trial type:</Text>
                    {[
                      { key: "paid", label: "Paid" },
                      { key: "free", label: "Free" },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        disabled={readOnly}
                        onPress={() => setSub(student.id, key)}
                        className={`px-4 py-1.5 rounded-full border ${
                          state.sub === key
                            ? "bg-blue-500 border-blue-500"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            state.sub === key ? "text-white" : "text-gray-600"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* ── Coaches present ────────────────────────────────────────────
            Renders NOTHING when the class has no shadows, so a business that
            has never assigned one gains no new furniture on its screens.

            Pre-ticked on purpose. The failure mode of a blank list is a coach
            who forgets and silently costs a trainee their pay, which appears
            nowhere; the failure mode of a pre-ticked one is an overpayment,
            which appears as a line on the Wages page and can be seen. */}
        {!readOnly && shadowsHere.length > 0 && (
          <View className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
            <Text className="text-sm font-semibold text-gray-900">
              Coaches present
            </Text>
            <Text className="mt-0.5 text-xs text-gray-500">
              Untick anyone who wasn&apos;t here — they won&apos;t be paid for
              this lesson.
            </Text>
            {shadowsHere.map((sh) => (
              <TouchableOpacity
                key={sh.coach_id}
                onPress={() =>
                  setShadowsHere((prev) =>
                    prev.map((x) =>
                      x.coach_id === sh.coach_id
                        ? { ...x, present: !x.present }
                        : x
                    )
                  )
                }
                className="mt-3 flex-row items-center"
              >
                <View
                  className={`h-5 w-5 items-center justify-center rounded border ${
                    sh.present
                      ? "bg-blue-500 border-blue-500"
                      : "bg-white border-gray-300"
                  }`}
                >
                  {sh.present && (
                    <Text className="text-xs font-bold text-white">✓</Text>
                  )}
                </View>
                {/* ⚠ THE NAME IS ITS OWN LEAF <Text>, DIRECTLY INSIDE THE
                    TOUCHABLE. RN-web puts the press handler on the Pressable and
                    a click on a nested Text child is swallowed silently — the
                    same trap every marking driver in this repo works around. A
                    name wrapped in an outer Text with a sibling span is not a
                    leaf at all, so it cannot be pressed by text and the tick
                    becomes untestable. */}
                <Text
                  className={`ml-2.5 text-sm ${
                    sh.present ? "text-gray-900" : "text-gray-400"
                  }`}
                >
                  {sh.name}
                </Text>
                <Text className="ml-1 text-xs text-gray-400">· shadowing</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

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
      {menuOpen && (
        <>
          <Pressable
            onPress={() => setMenuOpen(false)}
            className="absolute left-0 right-0 top-0 bottom-0 z-40"
          />
          <View className="absolute right-5 top-14 z-50 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
            {SET_ALL_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => onSetAll(opt)}
                className={`flex-row items-center gap-2.5 px-4 py-3 ${
                  i > 0 ? "border-t border-gray-100" : ""
                }`}
              >
                <View className={`h-2.5 w-2.5 rounded-full ${opt.dot}`} />
                <Text className="text-sm text-gray-800">{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
