// Upcoming lessons — derived, above the history, outside the status filter.
// Moved from app/(parent)/attendance/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). UI restyle step 3.7: flat cards; a lesson's kind is a tag in the status
// scale — Make-up and Extra lesson Info (booked for the child), Cancelled neutral —
// and the section labels are sentence case.
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { Tag } from "@/components/ui/Tag";
import { SectionHeading } from "@/components/ui/SectionHeading";
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
            <SectionHeading className="mb-2">Upcoming</SectionHeading>
            {upcoming.map((u) => {
              const cancelled = u.kind === "cancelled";
              return (
                <Surface key={u.key} className="flex-row items-center gap-3 mb-2">
                  <Ionicons
                    name={cancelled ? "close-circle-outline" : "calendar-outline"}
                    size={22}
                    color={cancelled ? "#6b6b6b" : "#525252"}
                  />
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 flex-wrap">
                      <Text
                        className={`text-body font-medium ${
                          cancelled ? "text-ink-muted line-through" : "text-ink"
                        }`}
                      >
                        {u.class_title}
                      </Text>
                      {u.kind !== "class" && (
                        <Tag
                          label={
                            u.kind === "makeup"
                              ? "Make-up"
                              : cancelled
                              ? "Cancelled"
                              : "Extra lesson"
                          }
                          tone={cancelled ? "neutral" : "info"}
                        />
                      )}
                    </View>
                    <Text
                      className={`text-body-secondary ${
                        cancelled ? "text-ink-muted line-through" : "text-ink-secondary"
                      }`}
                    >
                      {formatSgDate(u.session_date, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {u.time_label ? ` · ${u.time_label}` : ""}
                    </Text>
                    {cancelled && u.reason ? (
                      <Text className="text-body-secondary text-ink-secondary mt-0.5">{u.reason}</Text>
                    ) : null}
                  </View>
                </Surface>
              );
            })}
            {records.length > 0 && (
              <SectionHeading className="mt-3 mb-2">History</SectionHeading>
            )}
          </View>
        )}
    </>
  );
}
