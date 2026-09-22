// The status pill.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { progressLabel, type LessonProgress } from "@/lib/attendanceSummary";

/**
 * The status pill. One component for every section, so a state cannot be worded
 * or coloured one way here and another way there.
 *
 * Colour carries no information the text does not — the label is always present
 * — because a coach reading this outdoors on a phone is exactly the case where
 * colour alone fails.
 */
export function ProgressChip({ progress }: { progress: LessonProgress }) {
  // `hex` as well as the Tailwind class: Ionicons takes a colour PROP and
  // ignores className, so without it the glyph renders default black inside a
  // coloured pill. Keep the two in step.
  const tone = {
    "no-students": { bg: "bg-gray-100",   fg: "text-gray-500",   hex: "#6b7280", icon: "remove-outline" },
    upcoming:      { bg: "bg-gray-100",   fg: "text-gray-500",   hex: "#6b7280", icon: "time-outline" },
    unmarked:      { bg: "bg-orange-100", fg: "text-orange-700", hex: "#c2410c", icon: "alert-circle-outline" },
    partial:       { bg: "bg-amber-100",  fg: "text-amber-700",  hex: "#b45309", icon: "ellipse-outline" },
    complete:      { bg: "bg-green-100",  fg: "text-green-700",  hex: "#15803d", icon: "checkmark-circle" },
  }[progress.kind];

  return (
    <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${tone.bg}`}>
      <Ionicons name={tone.icon as any} size={12} color={tone.hex} />
      <Text className={`text-xs font-semibold ${tone.fg}`}>
        {progressLabel(progress)}
      </Text>
    </View>
  );
}
