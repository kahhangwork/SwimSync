import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  formatSgDate,
  ageFromDob,
} from "@/lib/lessonDates";
import { progressLabel, isFinished } from "@/lib/attendanceSummary";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";
import { formatTime, formatDate, capitalize } from "@/features/roster/domain/rosterFormat";
import { useRosterData } from "@/features/roster/domain/useRosterData";
import { useRemoveStudent } from "@/features/roster/domain/useRemoveStudent";
import { useOpenLevel } from "@/features/roster/domain/useOpenLevel";

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
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {classInfo?.title ?? "Class"}
          </Text>
          <Text className="text-xs text-gray-500">
            {capitalize(classInfo?.day_of_week ?? "")} ·{" "}
            {formatTime(classInfo?.start_time ?? "")} –{" "}
            {formatTime(classInfo?.end_time ?? "")}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Mark attendance — the most recent expected lesson within the window.
            No target = no lesson has fallen due yet (e.g. a brand-new class). */}
        <View className="mb-5">
          {markTarget ? (
            <>
              <PrimaryButton
                label={`Mark Attendance — ${formatDate(markTarget.date)}${
                  markTarget.date === todayDate ? " (Today)" : ""
                }`}
                onPress={() =>
                  router.push(
                    `/(coach)/classes/${id}/attendance?date=${markTarget.date}&from=roster`
                  )
                }
              />
              {windowStart && (
                <Text className="text-xs text-gray-400 mt-2 text-center">
                  You can mark lessons back to {formatDate(windowStart)}. Earlier
                  lessons are closed — a correction to an already-invoiced lesson
                  uses a credit note instead.
                </Text>
              )}
            </>
          ) : (
            <Card className="items-center py-6 border-sky-100 bg-sky-50">
              <Ionicons name="calendar-outline" size={28} color="#7dd3fc" />
              <Text className="text-gray-600 font-semibold mt-2">
                No lessons to mark yet
              </Text>
              <Text className="text-xs text-gray-500 mt-1 text-center">
                {students.length === 0
                  ? "Assign students to this class first."
                  : "This class's first lesson hasn't taken place yet — nothing to mark."}
              </Text>
            </Card>
          )}
        </View>

        {/* ── Trials coming up ─────────────────────────────────────────────
            Listed ABOVE the roster because it is the thing the coach does not
            already know. They are guests for one lesson, not members, so they
            are deliberately a separate list rather than mixed into the roster —
            mixing them would imply a weekly student. */}
        {upcomingTrials.length > 0 && (
          <View className="mb-5 bg-sky-50 rounded-2xl p-4 border border-sky-100">
            <Text className="text-sm font-bold text-sky-900">
              Trial{upcomingTrials.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingTrials.map((tr) => (
              <View
                key={`${tr.id}-${tr.session_date}`}
                className="mt-2 flex-row items-center justify-between"
              >
                <Text className="text-sm text-sky-900">{tr.full_name}</Text>
                <Text className="text-xs font-medium text-sky-700">
                  {formatSgDate(tr.session_date)}
                </Text>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-sky-700">
              Trying one lesson — mark them like anyone else on the day.
            </Text>
          </View>
        )}

        {/* ── Make-ups coming up ───────────────────────────────────────────
            An enrolled child from another class of the same kind, guesting
            for one lesson. Separate from trials because the coach's job
            differs: a make-up child is not new to the business, and the
            ordinary statuses apply — there is nothing to sell. */}
        {upcomingMakeups.length > 0 && (
          <View className="mb-5 bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
            <Text className="text-sm font-bold text-emerald-900">
              Make-up{upcomingMakeups.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingMakeups.map((mk) => (
              <View
                key={`${mk.id}-${mk.session_date}`}
                className="mt-2 flex-row items-center justify-between"
              >
                <Text className="text-sm text-emerald-900">{mk.full_name}</Text>
                <Text className="text-xs font-medium text-emerald-700">
                  {formatSgDate(mk.session_date)}
                </Text>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-emerald-700">
              Joining this one lesson as a make-up — mark them like anyone
              else on the day.
            </Text>
          </View>
        )}

        {/* ── Extra lessons coming up ──────────────────────────────────────
            A lesson on a day this class does not normally run, arranged by the
            business's admin. Shown here for the same reason trials are: it is
            the thing the coach does not already know, and their weekday-based
            expectation of this class will not produce it. */}
        {upcomingExtras.length > 0 && (
          <View className="mb-5 bg-amber-50 rounded-2xl p-4 border border-amber-100">
            <Text className="text-sm font-bold text-amber-900">
              Extra lesson{upcomingExtras.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingExtras.map((ex) => (
              <View key={ex.id} className="mt-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm text-amber-900">{ex.reason}</Text>
                  <Text className="text-xs font-medium text-amber-700">
                    {formatSgDate(ex.session_date)}
                  </Text>
                </View>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-amber-700">
              Not this class's usual day — mark it as normal once it has taken
              place.
            </Text>
          </View>
        )}

        {/* Enrolled Students */}
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-base font-bold text-gray-900">
            Students ({students.length})
          </Text>
        </View>

        <View className="gap-2 mb-6">
          {students.length === 0 ? (
            <Card className="items-center py-6">
              <Text className="text-gray-400 text-sm">No students enrolled</Text>
            </Card>
          ) : (
            students.map((student) => (
              <Card key={student.id}>
               <View className="flex-row items-center gap-3">
                <View className="w-9 h-9 rounded-full bg-sky-100 items-center justify-center">
                  <Text className="text-sky-600 font-bold text-sm">
                    {student.full_name.charAt(0)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-gray-800">
                    {student.full_name}
                  </Text>
                  {/* Age is the everyday useful fact. The BIRTHDAY only appears
                      when another child on this roster shares the name — that
                      is the case the identity rule exists for, and two children
                      of the same name can easily be the same age, so age alone
                      would not tell them apart. */}
                  {(() => {
                    const age = ageFromDob(student.date_of_birth);
                    const ambiguous = duplicateNames.has(
                      student.full_name.trim().toLowerCase()
                    );
                    if (age === null && !ambiguous && !student.level_label) return null;
                    return (
                      <Text className="text-xs text-gray-500 mt-0.5">
                        {student.level_label ? `${student.level_label} · ` : ""}
                        {age !== null ? `Age ${age}` : "Age unknown"}
                        {/* WITH THE YEAR — formatSgDate's default omits it,
                            and the year is usually the only thing separating
                            two children of the same name. "born 10 Mar" would
                            render identically for both of them. */}
                        {ambiguous && student.date_of_birth
                          ? ` · born ${formatSgDate(student.date_of_birth, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : ""}
                      </Text>
                    );
                  })()}
                </View>
                {/* VIEW this child's skill grades. Read-only since
                    20260829000100 — grading moved to the admin panel's
                    Assessment tab, so the label says Skills, not Grade: the
                    coach is looking something up, not recording it. A direct
                    leaf <Text> inside the Pressable — RN-web swallows the tap
                    otherwise (§7.10-adjacent). */}
                <Pressable
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${id}/grade?studentId=${student.id}`
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200"
                >
                  <Text className="text-xs font-semibold text-sky-600">Skills</Text>
                </Pressable>
                {/* A child who has stopped coming keeps this class permanently
                    "incomplete" — every lesson expects a mark for them — and
                    that now blocks invoicing outright. This is the in-app way
                    out. */}
                <Pressable
                  onPress={() => handleRemove(student)}
                  disabled={removingId === student.id}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200"
                >
                  <Text className="text-xs font-semibold text-gray-500">
                    {removingId === student.id ? "Removing…" : "Remove"}
                  </Text>
                </Pressable>
               </View>

                {/* The level's curriculum, on tap. Collapsed by default: a
                    roster of six children on three levels would otherwise be
                    thirty lines of skills, and the coach opens the one they
                    are teaching. */}
                {student.level_label &&
                (student.level_skills.length > 0 || student.level_note) ? (
                  <Pressable
                    onPress={() =>
                      setOpenLevelFor(
                        openLevelFor === student.id ? null : student.id
                      )
                    }
                    className="mt-2 pt-2 border-t border-gray-100"
                  >
                    <Text className="text-xs font-medium text-sky-600">
                      {openLevelFor === student.id ? "Hide" : "What"}{" "}
                      {student.level_label} {openLevelFor === student.id ? "" : "covers"}
                    </Text>
                  </Pressable>
                ) : null}

                {openLevelFor === student.id ? (
                  <View className="mt-2 gap-1.5">
                    {student.level_note ? (
                      <Text className="text-xs italic text-gray-500 mb-1">
                        {student.level_note}
                      </Text>
                    ) : null}
                    {student.level_skills.map((skill, i) => (
                      <View key={`${skill}-${i}`} className="flex-row gap-2">
                        <Text className="text-xs text-sky-500 font-semibold w-3.5">
                          {i + 1}
                        </Text>
                        <Text className="text-xs text-gray-700 flex-1">{skill}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </View>

        {/* Past Sessions */}
        <Text className="text-base font-bold text-gray-900 mb-3">
          Past Sessions
        </Text>

        {sessions.length === 0 ? (
          <Card className="items-center py-6">
            <Ionicons name="calendar-outline" size={32} color="#d1d5db" />
            <Text className="text-gray-400 mt-2 text-sm">
              No sessions recorded yet
            </Text>
          </Card>
        ) : (
          <View className="gap-2">
            {sessions.map((session) => {
              const cancelled = session.cancelled === true;
              const complete = isFinished(session.progress);
              const unmarked = session.id === null;
              return (
                <TouchableOpacity
                  key={session.session_date}
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${id}/attendance?date=${session.session_date}&from=roster`
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Card
                    className={`flex-row items-center gap-3 ${
                      cancelled
                        ? "opacity-60"
                        : unmarked
                        ? "border-orange-200 bg-orange-50"
                        : ""
                    }`}
                  >
                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center ${
                        cancelled
                          ? "bg-gray-100"
                          : complete
                          ? "bg-green-100"
                          : "bg-orange-100"
                      }`}
                    >
                      <Ionicons
                        name={cancelled ? "close" : complete ? "checkmark" : "alert"}
                        size={18}
                        color={cancelled ? "#6b7280" : complete ? "#16a34a" : "#ea580c"}
                      />
                    </View>
                    <View className="flex-1">
                      <Text
                        className={`text-sm font-semibold ${
                          cancelled ? "text-gray-500 line-through" : "text-gray-800"
                        }`}
                      >
                        {formatDate(session.session_date)}
                      </Text>
                      <Text
                        className={`text-xs ${
                          cancelled
                            ? "text-gray-500"
                            : complete
                            ? "text-green-600"
                            : "text-orange-500"
                        }`}
                      >
                        {cancelled
                          ? "Cancelled by your admin"
                          : progressLabel(session.progress)}
                      </Text>
                      {/* Omitted entirely when nothing is recorded — never a
                          dangling separator. A cancelled lesson shows its
                          reason instead, so the coach knows why it is struck. */}
                      {session.summary ? (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {session.summary}
                        </Text>
                      ) : cancelled && session.cancelReason ? (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {session.cancelReason}
                        </Text>
                      ) : null}
                    </View>
                    <View className="flex-row items-center gap-1">
                      <Text className="text-xs text-sky-500">
                        {complete ? "Edit" : "Mark"}
                      </Text>
                      <Ionicons name="chevron-forward" size={13} color="#0ea5e9" />
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
