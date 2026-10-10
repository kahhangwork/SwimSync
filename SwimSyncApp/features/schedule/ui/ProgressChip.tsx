// The status tag on every lesson card.
import React from "react";
import { View, Text } from "react-native";
import { progressLabel, type LessonProgress } from "@/lib/attendanceSummary";

/**
 * The status tag. One component for every section, so a state cannot be worded
 * or coloured one way here and another way there.
 *
 * DESIGN.md's five-step scale, always as a WORD in a bordered tag — a coach
 * reading this outdoors on a phone is exactly the case where colour alone fails:
 * nothing to mark yet → neutral; not or partly marked → warning (needs doing);
 * marked → success. A PAST unmarked lesson is not shown here as red: it sits in
 * the Danger container above (NeedsMarkingSection), which says what it blocks.
 */
const TONE = {
  "no-students": { box: "bg-status-neutral-bg border-status-neutral-border", text: "text-status-neutral-text" },
  upcoming:      { box: "bg-status-neutral-bg border-status-neutral-border", text: "text-status-neutral-text" },
  unmarked:      { box: "bg-status-warning-bg border-status-warning-border", text: "text-status-warning-text" },
  partial:       { box: "bg-status-warning-bg border-status-warning-border", text: "text-status-warning-text" },
  complete:      { box: "bg-status-success-bg border-status-success-border", text: "text-status-success-text" },
} as const;

export function ProgressChip({ progress }: { progress: LessonProgress }) {
  const tone = TONE[progress.kind];
  return (
    <View className={`self-start rounded-tag border px-1.5 py-0.5 ${tone.box}`}>
      <Text className={`text-label font-medium ${tone.text}`}>{progressLabel(progress)}</Text>
    </View>
  );
}
