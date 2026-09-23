// The classes, grouped under a weekday header, today first.
// Moved VERBATIM from app/(coach)/classes/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
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
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : classes.length === 0 ? (
        <Card className="items-center py-10">
          <Ionicons name="calendar-outline" size={40} color="#d1d5db" />
          <Text className="text-gray-400 mt-3 text-sm">No classes assigned yet</Text>
        </Card>
      ) : (
        <View className="gap-5">
          {groups.map((group) => (
            <View key={group.day}>
              {/* The weekday is a SECTION HEADER now, not a line on every
                  card — so it reads once per group instead of once per class,
                  and today is findable without reading any of them. */}
              <View className="flex-row items-center gap-2 mb-2 px-0.5">
                <Text
                  className={`text-xs font-bold uppercase tracking-wide ${
                    group.isToday ? "text-sky-600" : "text-gray-400"
                  }`}
                >
                  {group.isToday
                    ? `Today · ${weekdayLabel(group.day)}`
                    : weekdayLabel(group.day)}
                </Text>
                <View
                  className={`flex-1 h-px ${
                    group.isToday ? "bg-sky-100" : "bg-gray-200"
                  }`}
                />
              </View>

              <View className="gap-3">
                {group.items.map((cls) => (
                  <TouchableOpacity
                    key={cls.id}
                    onPress={() => router.push(`/(coach)/classes/${cls.id}/roster`)}
                    activeOpacity={0.8}
                  >
                    <Card className={group.isToday ? "border-sky-200" : ""}>
                      <View className="flex-row items-start justify-between mb-3">
                        <View className="flex-1">
                          <Text className="text-base font-bold text-gray-900">
                            {cls.title}
                          </Text>
                        </View>
                        <View className="bg-sky-100 rounded-full px-3 py-1">
                          <Text className="text-xs font-semibold text-sky-700">
                            {cls.student_count} students
                          </Text>
                        </View>
                      </View>

                      <View className="gap-1.5">
                        <View className="flex-row items-center gap-2">
                          <Ionicons name="time-outline" size={14} color="#6b7280" />
                          <Text className="text-sm text-gray-600">
                            {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-2">
                          <Ionicons name="location-outline" size={14} color="#6b7280" />
                          <Text className="text-sm text-gray-600">
                            {cls.location_name}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-2">
                          <Ionicons name="cash-outline" size={14} color="#6b7280" />
                          <Text className="text-sm text-gray-600">
                            S${cls.price_per_lesson.toFixed(2)} / lesson
                          </Text>
                        </View>
                      </View>

                      <View className="flex-row items-center justify-end mt-3 gap-1">
                        <Text className="text-xs text-sky-500">View Roster & Sessions</Text>
                        <Ionicons name="chevron-forward" size={13} color="#0ea5e9" />
                      </View>
                    </Card>
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
