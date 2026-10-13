// The marked history and its five empty states (PRD §5.1).
// Moved from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); DESIGN.md in UI restyle step 3.7 — flat cards, Ink text, the status a
// word beside its icon. Which state shows when is unchanged.
import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { STATUS_ICON, STATUS_LABEL } from "../constants";
import { formatDate } from "../domain/attendanceFormat";
import type { useParentAttendance } from "../domain/useParentAttendance";

type Att = ReturnType<typeof useParentAttendance>;

export function HistoryList(p: Pick<Att, "loadingRecords" | "children" | "selectedChild" | "records" | "hasExpectedLesson" | "filtered" | "filter">) {
  const { loadingRecords, children, selectedChild, records, hasExpectedLesson, filtered, filter } = p;
  return (
    <>
      {loadingRecords ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : children.length === 0 ? (
        <View className="items-center py-16">
          <Ionicons name="people-outline" size={40} color="#6b6b6b" />
          <Text className="text-body text-ink-secondary mt-3">No children added yet</Text>
        </View>
      ) : selectedChild?.assignment_status === "unassigned" ? (
        // PRD §5.1: before assignment the attendance section shows a
        // "not assigned yet" state — not an empty list, which reads as broken.
        <View className="items-center py-16 px-4">
          <Ionicons name="hourglass-outline" size={40} color="#6b6b6b" />
          <Text className="text-body font-semibold text-ink mt-3">
            {selectedChild.full_name.split(" ")[0]} isn&apos;t in a class yet
          </Text>
          <Text className="text-body-secondary text-ink-secondary mt-1 text-center">
            Not yet assigned to a class. The admin will assign your child soon.
            Lessons will show up here once that&apos;s done.
          </Text>
        </View>
      ) : records.length === 0 ? (
        hasExpectedLesson ? (
          // A lesson has already fallen due but nothing is recorded — the ball
          // is in the coach's court.
          <View className="items-center py-16 px-4">
            <Ionicons name="calendar-outline" size={40} color="#6b6b6b" />
            <Text className="text-body font-semibold text-ink mt-3 text-center">
              No lessons marked yet
            </Text>
            <Text className="text-body-secondary text-ink-secondary mt-1 text-center">
              Lessons appear here once the coach marks attendance.
            </Text>
          </View>
        ) : (
          // No lesson has happened since this child joined — nothing is late,
          // so don't imply the coach is behind.
          <View className="items-center py-16 px-4">
            <Ionicons name="hourglass-outline" size={40} color="#6b6b6b" />
            <Text className="text-body font-semibold text-ink mt-3 text-center">
              No lessons have taken place yet
            </Text>
            <Text className="text-body-secondary text-ink-secondary mt-1 text-center">
              {selectedChild?.full_name.split(" ")[0]} is in a class, but the first
              lesson hasn&apos;t happened yet. Attendance will appear here after it does.
            </Text>
          </View>
        )
      ) : filtered.length === 0 ? (
        <View className="items-center py-16">
          <Ionicons name="funnel-outline" size={40} color="#6b6b6b" />
          <Text className="text-body text-ink-secondary mt-3">
            No {filter.toLowerCase()} lessons
          </Text>
        </View>
      ) : (
        filtered.map((item) => {
          const icon = STATUS_ICON[item.status];
          return (
            <Surface key={item.id} className="flex-row items-center gap-3">
              <Ionicons
                name={icon.name as any /* db-any-ok: icon */}
                size={22}
                color={icon.color}
              />
              <View className="flex-1">
                <Text className="text-body font-medium text-ink">
                  {item.class_title}
                </Text>
                <Text className="text-body-secondary text-ink-secondary">
                  {formatDate(item.session_date)}
                </Text>
              </View>
              <Text className="text-body-secondary font-medium text-ink text-right max-w-[110px]">
                {STATUS_LABEL[item.status]}
              </Text>
            </Surface>
          );
        })
      )}
    </>
  );
}
