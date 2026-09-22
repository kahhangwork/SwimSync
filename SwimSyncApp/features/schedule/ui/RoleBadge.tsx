// The Covering / Shadowing / Covered badge.
// Moved VERBATIM from app/(coach)/schedule/index.tsx (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 5); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { roleBadge, type LessonRole } from "@/lib/coachRoster";

/**
 * "Covering" / "Shadowing" / "Covered" — who is teaching a lesson, when it is
 * not simply the coach reading the screen.
 *
 * ⚠ VIOLET, AND NOT ONE OF THE PROGRESS CHIP'S COLOURS. This says something
 * orthogonal to marking state — a covered lesson can be unmarked, partial or
 * complete — and reusing amber or green here would read as a fourth status.
 * `null` for an ordinary lesson: a business that has never rostered anybody
 * gains no new furniture on its screens.
 *
 * Module scope for the same reason as `ProgressChip` and `DaySection` below.
 */
export function RoleBadge({ role }: { role: LessonRole }) {
  const label = roleBadge(role);
  if (!label) return null;
  return (
    <View className="self-start rounded-full bg-violet-100 px-2 py-0.5 mt-1">
      <Text className="text-[10px] font-semibold text-violet-700">{label}</Text>
    </View>
  );
}
