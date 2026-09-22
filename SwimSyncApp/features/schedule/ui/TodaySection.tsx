// TODAY — only in the current week.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { isNowInRange } from "@/lib/timeOfDay";
import { formatAttendees, isFinished } from "@/lib/attendanceSummary";
import { canMark } from "@/lib/coachRoster";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";
import { formatTime, dayHeading } from "../domain/scheduleFormat";
import { ProgressChip } from "./ProgressChip";
import { RoleBadge } from "./RoleBadge";
import type { useWeek } from "../domain/useWeek";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Week = ReturnType<typeof useWeek>;
type Sections = ReturnType<typeof useScheduleSections>;

export function TodaySection(p: Pick<Week, "showsTodaySection" | "todayDate" | "nowMins"> & Pick<Sections, "todayLessons" | "todayStudents" | "todayGuests" | "openAttendance">) {
  const { showsTodaySection, todayDate, nowMins, todayLessons, todayStudents, todayGuests, openAttendance } = p;
  return (
    <>
      {/* ── TODAY — only in the current week ───────────────────────── */}
      {showsTodaySection && (
        <View className="mb-6">
          <Text className="text-lg font-bold text-gray-900">
            TODAY · {dayHeading(todayDate)}
          </Text>
          {/* The three tiles this replaced (Classes / Students / Guests
              Today) are folded in here — every number kept, the vertical
              space reclaimed, because this screen is far denser than the
              one-day screen it replaces. Guests stay counted APART from
              students: a guest at one lesson is not a weekly student. */}
          <Text className="text-xs text-gray-500 mb-3">
            {todayLessons.length === 0
              ? "No lessons today."
              : `${todayLessons.length === 1 ? "1 lesson" : `${todayLessons.length} lessons`} · ${formatAttendees(todayStudents, todayGuests)}`}
          </Text>

          <View className="gap-3">
            {todayLessons.map((l) => {
              const isActive = isNowInRange(l.startTime, l.endTime, nowMins);
              return (
                <Card
                  key={`${l.classId}:${l.date}`}
                  className={isActive ? "border-sky-200 bg-sky-50" : ""}
                >
                  {isActive && (
                    <View className="flex-row items-center gap-1.5 mb-2">
                      <View className="w-2 h-2 rounded-full bg-green-500" />
                      <Text className="text-xs font-semibold text-green-600">
                        Now
                      </Text>
                    </View>
                  )}

                  <View className="flex-row items-start justify-between mb-3">
                    <View className="flex-1">
                      <Text
                        className={`text-base font-bold ${
                          l.cancelled ? "text-gray-500 line-through" : "text-gray-900"
                        }`}
                      >
                        {l.title}
                      </Text>
                      {l.cancelled && (
                        <Text className="text-xs font-semibold text-gray-500 mt-0.5">
                          Cancelled by your admin — nothing to mark
                        </Text>
                      )}
                      <View className="flex-row items-center gap-1.5 mt-1">
                        <Ionicons name="time-outline" size={13} color="#6b7280" />
                        <Text className="text-xs text-gray-500">
                          {formatTime(l.startTime)} – {formatTime(l.endTime)}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5 mt-0.5">
                        <Ionicons name="location-outline" size={13} color="#6b7280" />
                        <Text className="text-xs text-gray-500">
                          {l.location}
                        </Text>
                      </View>
                      <RoleBadge role={l.role} />
                    </View>
                    <ProgressChip progress={l.progress} />
                  </View>

                  <Text className="text-xs text-gray-500 mb-3 -mt-1">
                    {formatAttendees(l.students, l.guests)}
                    {l.summary ? ` · ${l.summary}` : ""}
                  </Text>

                  {/* isFinished, NOT `kind !== "unmarked"`. A card that
                      stops asking for marks it still needs is a lesson
                      that never gets marked, and that blocks the month
                      with no override (§8a). Any state added later
                      inherits the loud button.

                      A lesson I am shadowing, or one another coach was
                      rostered to cover, is the ONE case where the loud
                      button is wrong: the database refuses my write, so
                      "Mark Attendance" could only ever end in an error
                      toast. The screen behind it still opens, read-only,
                      because knowing who is expected is the reason a
                      trainee is there at all. */}
                  <PrimaryButton
                    label={
                      !canMark(l.role)
                        ? "View lesson"
                        : isFinished(l.progress)
                          ? "Edit attendance"
                          : "Mark Attendance"
                    }
                    variant={
                      !canMark(l.role) || isFinished(l.progress)
                        ? "outline"
                        : "primary"
                    }
                    onPress={() => openAttendance(l)}
                  />
                </Card>
              );
            })}
          </View>
        </View>
      )}
    </>
  );
}
