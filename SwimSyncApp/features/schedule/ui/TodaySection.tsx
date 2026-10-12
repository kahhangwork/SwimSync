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
import { CARD, ScheduleButton } from "./ScheduleButton";
import { formatTime, dayHeading } from "../domain/scheduleFormat";
import { ProgressChip } from "./ProgressChip";
import { RoleBadge } from "./RoleBadge";
import type { useWeek } from "../domain/useWeek";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Week = ReturnType<typeof useWeek>;
type Sections = ReturnType<typeof useScheduleSections>;

export function TodaySection(p: Pick<Week, "showsTodaySection" | "todayDate" | "nowMins"> & Pick<Sections, "todayLessons" | "todayStudents" | "todayGuests" | "openAttendance"> & {
  /** Needs marking is showing — its button is the screen's one primary, so a
   *  routine lesson here does not outrank it (DESIGN.md, Blocker-Outranks-Routine). */
  blockerShown: boolean;
}) {
  const { showsTodaySection, todayDate, nowMins, todayLessons, todayStudents, todayGuests, openAttendance, blockerShown } = p;
  return (
    <>
      {/* ── TODAY — only in the current week ───────────────────────── */}
      {showsTodaySection && (
        <View className="mb-5">
          {/* "Today · <day>" then the count on the NEXT line: a driver reads the
              count with /Today · [^\n]*\n(\d+ lessons?|No lessons today\.)/.
              Match it case-SENSITIVELY: Coach Classes' "Today · <weekday>" group
              heading is `uppercase`, so innerText reads it "TODAY · …" (§7.362)
              and only this heading matches "Today ·". */}
          <Text className="text-label font-semibold text-ink-muted">
            Today · {dayHeading(todayDate)}
          </Text>
          {/* The three tiles this replaced (Classes / Students / Guests
              Today) are folded in here — every number kept, the vertical
              space reclaimed, because this screen is far denser than the
              one-day screen it replaces. Guests stay counted APART from
              students: a guest at one lesson is not a weekly student. */}
          <Text className="text-body-secondary text-ink-secondary mb-2">
            {todayLessons.length === 0
              ? "No lessons today."
              : `${todayLessons.length === 1 ? "1 lesson" : `${todayLessons.length} lessons`} · ${formatAttendees(todayStudents, todayGuests)}`}
          </Text>

          <View className="gap-3">
            {todayLessons.map((l) => {
              const isActive = isNowInRange(l.startTime, l.endTime, nowMins);
              return (
                <View
                  key={`${l.classId}:${l.date}`}
                  // On now: a stronger edge, not a tint — the One Blue Rule keeps
                  // blue for actions, and the "Now" word carries the meaning.
                  className={`${CARD} ${isActive ? "border-border-strong" : ""}`}
                >
                  {isActive && (
                    <View className="flex-row items-center gap-1.5 mb-2">
                      <View className="w-2 h-2 rounded-full bg-status-success-text" />
                      <Text className="text-label font-semibold text-ink">
                        Now
                      </Text>
                    </View>
                  )}

                  <View className="flex-row items-start justify-between mb-3">
                    <View className="flex-1">
                      <Text
                        className={`text-headline font-semibold ${
                          l.cancelled ? "text-ink-muted line-through" : "text-ink"
                        }`}
                      >
                        {l.title}
                      </Text>
                      {l.cancelled && (
                        <Text className="text-body-secondary font-semibold text-ink-secondary mt-0.5">
                          Cancelled by your admin — nothing to mark
                        </Text>
                      )}
                      <View className="flex-row items-center gap-1.5 mt-1">
                        <Ionicons name="time-outline" size={13} color="#6b6b6b" />
                        <Text className="text-body-secondary text-ink-secondary">
                          {formatTime(l.startTime)} – {formatTime(l.endTime)}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5 mt-0.5">
                        <Ionicons name="location-outline" size={13} color="#6b6b6b" />
                        <Text className="text-body-secondary text-ink-secondary">
                          {l.location}
                        </Text>
                      </View>
                      <RoleBadge role={l.role} />
                    </View>
                    <ProgressChip progress={l.progress} />
                  </View>

                  <Text className="text-body-secondary text-ink-secondary mb-3 -mt-1">
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
                  <ScheduleButton
                    label={
                      !canMark(l.role)
                        ? "View lesson"
                        : isFinished(l.progress)
                          ? "Edit attendance"
                          : "Mark Attendance"
                    }
                    variant={
                      !canMark(l.role) || isFinished(l.progress) || blockerShown
                        ? "secondary"
                        : "primary"
                    }
                    onPress={() => openAttendance(l)}
                  />
                </View>
              );
            })}
          </View>
        </View>
      )}
    </>
  );
}
