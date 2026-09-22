// NEEDS MARKING — the floor-scoped backlog.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatSgDate } from "@/lib/lessonDates";
import { progressLabel } from "@/lib/attendanceSummary";
import Card from "@/components/Card";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Sections = ReturnType<typeof useScheduleSections>;

export function NeedsMarkingSection(p: Pick<Sections, "visibleNeedsMarking" | "openAttendance">) {
  const { visibleNeedsMarking, openAttendance } = p;
  return (
    <>
      {/* ── NEEDS MARKING ─────────────────────────────────────────────
          ⚠ THE HEADING STRING IS `NEEDS MARKING (N)` AND THE COUNT IS
          PART OF IT. Three drivers assert on it verbatim, and the
          parenthesised number is the only assertion that the floor-scoped
          set is neither larger nor smaller than it should be. Do not
          relax those regexes to a bare /NEEDS MARKING/. Keep this string
          UNIQUE on the screen too — a negative assertion elsewhere
          (`!/needs marking/i`) false-fails if the words appear twice. */}
      {visibleNeedsMarking.length > 0 && (
        <View className="mb-6">
          <Text className="text-lg font-bold text-gray-900 mb-1">
            NEEDS MARKING ({visibleNeedsMarking.length})
          </Text>
          <Text className="text-xs text-gray-500 mb-3">
            These lessons have no attendance yet and won&apos;t be billed
            until they do.
          </Text>
          <View className="gap-2">
            {visibleNeedsMarking.map((item) => (
              <TouchableOpacity
                key={`${item.class_id}:${item.date}`}
                onPress={() =>
                  openAttendance({
                    classId: item.class_id,
                    date: item.date,
                    sessionId: item.session_id,
                  })
                }
                activeOpacity={0.8}
              >
                <Card className="flex-row items-center gap-3 border-orange-200 bg-orange-50">
                  <View className="w-9 h-9 rounded-full bg-orange-100 items-center justify-center">
                    <Ionicons name="alert" size={18} color="#ea580c" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-gray-800">
                      {item.class_title}
                    </Text>
                    <Text className="text-xs text-orange-600">
                      {formatSgDate(item.date)}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-0.5">
                      {progressLabel(item.progress)}
                      {item.summary ? ` · ${item.summary}` : ""}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Text className="text-xs font-semibold text-orange-600">
                      Mark
                    </Text>
                    <Ionicons name="chevron-forward" size={13} color="#ea580c" />
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </>
  );
}
