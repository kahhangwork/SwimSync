// The classes, grouped under a weekday header, today first.
// Moved from app/(coach)/classes/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-H);
// restyled in UI restyle step 2.3: flat cards, the student count as plain text
// ("1 student", never "1 students"), sentence-case weekday headings.
import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Surface, SURFACE } from "@/components/ui/Surface";
import { formatAttendees } from "@/lib/attendanceSummary";
import { formatTime } from "../domain/classesFormat";
import { weekdayLabel } from "../domain/weekOrder";
import type { useCoachClasses } from "../domain/useCoachClasses";

type Classes = ReturnType<typeof useCoachClasses>;

export function ClassList(p: Pick<Classes, "loading" | "classes" | "groups">) {
  const { loading, classes, groups } = p;
  return (
    <>
      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : classes.length === 0 ? (
        <Surface className="items-center py-10">
          <Ionicons name="calendar-outline" size={40} color="#6b6b6b" />
          <Text className="text-body text-ink-secondary mt-3">No classes assigned yet</Text>
        </Surface>
      ) : (
        <View className="gap-5">
          {groups.map((group) => (
            <View key={group.day}>
              {/* The weekday is a SECTION HEADER, not a line on every card —
                  it reads once per group, and today is findable without
                  reading any of them. Today's heading is Ink; the rest muted.
                  verify-stale-screen matches it case-insensitively. */}
              <View className="flex-row items-center gap-2 mb-2">
                <Text
                  accessibilityRole="header"
                  className={
                    group.isToday
                      ? "text-label font-semibold text-ink"
                      : "text-label font-semibold text-ink-muted"
                  }
                >
                  {group.isToday
                    ? `Today · ${weekdayLabel(group.day)}`
                    : weekdayLabel(group.day)}
                </Text>
                <View className="flex-1 h-px bg-border" />
              </View>
              <View className="gap-2">
                {group.items.map((cls) => (
                  // The pressable IS the card (SURFACE), so a press anywhere on
                  // it — the title included, which is how the drivers press it
                  // (pressByText dispatches on the leaf's parent) — opens the
                  // roster.
                  <TouchableOpacity
                    key={cls.id}
                    testID="coach-class-card"
                    onPress={() => router.push(`/(coach)/classes/${cls.id}/roster`)}
                    activeOpacity={0.8}
                    className={SURFACE}
                  >
                    <View className="flex-row items-start justify-between gap-3 mb-2">
                      <Text className="flex-1 text-headline font-semibold text-ink">
                        {cls.title}
                      </Text>
                      {/* A count, not a status: plain text, never a pill. */}
                      <Text className="text-body-secondary text-ink-secondary">
                        {formatAttendees(cls.student_count, 0)}
                      </Text>
                    </View>
                    <View className="gap-1">
                      <View className="flex-row items-center gap-2">
                        <Ionicons name="time-outline" size={14} color="#525252" />
                        <Text className="text-body text-ink-secondary">
                          {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-2">
                        <Ionicons name="location-outline" size={14} color="#525252" />
                        <Text className="text-body text-ink-secondary">
                          {cls.location_name}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-2">
                        <Ionicons name="cash-outline" size={14} color="#525252" />
                        <Text className="text-body text-ink-secondary">
                          S${cls.price_per_lesson.toFixed(2)} / lesson
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row items-center justify-end mt-2 gap-1">
                      <Text className="text-body font-semibold text-primary">View Roster & Sessions</Text>
                      <Ionicons name="chevron-forward" size={14} color="#2563eb" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );
}
