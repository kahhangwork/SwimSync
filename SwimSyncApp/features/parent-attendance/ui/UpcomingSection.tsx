// Upcoming lessons — derived, above the history, outside the status filter.
// Moved VERBATIM from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
import { formatSgDate } from "@/lib/lessonDates";
import type { useParentAttendance } from "../domain/useParentAttendance";

type Att = ReturnType<typeof useParentAttendance>;

export function UpcomingSection(p: Pick<Att, "loadingRecords" | "selectedChild" | "upcoming" | "records">) {
  const { loadingRecords, selectedChild, upcoming, records } = p;
  return (
    <>
      {/* Upcoming lessons — derived, shown above the marked history and outside
          the status filter (it applies only to what has already happened). */}
      {!loadingRecords &&
        selectedChild?.assignment_status === "assigned" &&
        upcoming.length > 0 && (
          <View className="mb-1">
            <Text className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
              Upcoming
            </Text>
            {upcoming.map((u) => (
              <Card
                key={u.key}
                className={`flex-row items-center gap-3 mb-2 ${
                  u.kind === "cancelled" ? "opacity-70" : ""
                }`}
              >
                <Ionicons
                  name={u.kind === "cancelled" ? "close-circle-outline" : "calendar-outline"}
                  size={24}
                  color={u.kind === "cancelled" ? "#9ca3af" : "#0ea5e9"}
                />
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text
                      className={`text-sm font-semibold ${
                        u.kind === "cancelled"
                          ? "text-gray-500 line-through"
                          : "text-gray-800"
                      }`}
                    >
                      {u.class_title}
                    </Text>
                    {u.kind !== "class" && (
                      <View
                        className={`px-2 py-0.5 rounded-full ${
                          u.kind === "makeup"
                            ? "bg-emerald-100"
                            : u.kind === "cancelled"
                            ? "bg-gray-200"
                            : "bg-violet-100"
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-bold uppercase tracking-wide ${
                            u.kind === "makeup"
                              ? "text-emerald-700"
                              : u.kind === "cancelled"
                              ? "text-gray-600"
                              : "text-violet-700"
                          }`}
                        >
                          {u.kind === "makeup"
                            ? "Make-up"
                            : u.kind === "cancelled"
                            ? "Cancelled"
                            : "Extra lesson"}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    className={`text-xs ${
                      u.kind === "cancelled" ? "text-gray-400 line-through" : "text-gray-500"
                    }`}
                  >
                    {formatSgDate(u.session_date, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {u.time_label ? ` · ${u.time_label}` : ""}
                  </Text>
                  {u.kind === "cancelled" && u.reason ? (
                    <Text className="text-xs text-gray-500 mt-0.5">{u.reason}</Text>
                  ) : null}
                </View>
              </Card>
            ))}
            {records.length > 0 && (
              <Text className="text-xs font-bold uppercase tracking-wide text-gray-400 mt-3 mb-2">
                History
              </Text>
            )}
          </View>
        )}
    </>
  );
}
