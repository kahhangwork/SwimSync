// A collapsed day under COMING UP or DONE, expandable.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { formatAttendees, isFinished } from "@/lib/attendanceSummary";
import Card from "@/components/Card";
import type { WeekLesson } from "../types";
import { formatTime, dayHeading } from "../domain/scheduleFormat";
import { ProgressChip } from "./ProgressChip";
import { RoleBadge } from "./RoleBadge";

/**
 * A collapsed day under COMING UP or DONE.
 *
 * ⚠ MODULE SCOPE, NOT NESTED IN THE SCREEN. Declared inside the component body
 * this is a NEW component type on every render, so React unmounts and remounts
 * every COMING UP / DONE subtree on each one — including every expand press and
 * every `loading` flip. It survives that today only because it holds no state
 * of its own, and it stops surviving the moment anyone adds any. `ProgressChip`
 * is at module scope for the same reason.
 */
export function DaySection({
  group,
  tappable,
  open,
  onToggle,
  onOpenLesson,
}: {
  group: { date: string; items: WeekLesson[] };
  tappable: boolean;
  open: boolean;
  onToggle: (date: string) => void;
  onOpenLesson: (l: WeekLesson) => void;
}) {
  const allMarked = group.items.every((l) => isFinished(l.progress));
  return (
    <View className="mb-2">
      <TouchableOpacity
        onPress={() => onToggle(group.date)}
        className="flex-row items-center gap-2 py-2"
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={14}
          color="#6b7280"
        />
        <Text className="text-sm font-semibold text-gray-700">
          {dayHeading(group.date)}
        </Text>
        <Text className="text-xs text-gray-400">
          {group.items.length === 1 ? "1 lesson" : `${group.items.length} lessons`}
        </Text>
        {allMarked && (
          <Ionicons name="checkmark-circle" size={14} color="#15803d" />
        )}
      </TouchableOpacity>

      {open && (
        <View className="gap-2 pl-6">
          {group.items.map((l) => (
            <TouchableOpacity
              key={`${l.classId}:${l.date}`}
              activeOpacity={tappable ? 0.8 : 1}
              onPress={() =>
                tappable
                  ? onOpenLesson(l)
                  : // ⚠ A FUTURE LESSON MUST NOT REACH THE ATTENDANCE SCREEN.
                    // checkMarkableDate refuses `date > today` outright, and
                    // refuses a booking on a non-weekday date too, so the only
                    // exit from there is a `replace` back here — a dead tap.
                    // The roster is the honest destination for "who is coming".
                    router.push(`/(coach)/classes/${l.classId}/roster`)
              }
            >
              <Card>
                <View className="flex-row items-start justify-between">
                  <View className="flex-1">
                    <Text
                      className={`text-sm font-bold ${
                        l.cancelled ? "text-gray-500 line-through" : "text-gray-900"
                      }`}
                    >
                      {l.title}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-0.5">
                      {formatTime(l.startTime)} – {formatTime(l.endTime)}
                    </Text>
                    {l.cancelled && (
                      <Text className="text-xs font-semibold text-gray-500 mt-0.5">
                        Cancelled by your admin
                      </Text>
                    )}
                    <RoleBadge role={l.role} />
                  </View>
                  <ProgressChip progress={l.progress} />
                </View>
                <Text className="text-xs text-gray-500 mt-1">
                  {formatAttendees(l.students, l.guests)}
                  {l.summary ? ` · ${l.summary}` : ""}
                </Text>
              </Card>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
