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
 * ⚠ NOT ONE OF THE STATUS SCALE'S TINTS. This says something orthogonal to
 * marking state — a covered lesson can be unmarked, partial or complete — and a
 * status tint here would read as a sixth status. So it is a plain outlined tag:
 * Surface ground, Border Strong edge, Ink Secondary text (DESIGN.md has no violet).
 * `null` for an ordinary lesson: a business that has never rostered anybody
 * gains no new furniture on its screens.
 *
 * Module scope for the same reason as `ProgressChip` and `DaySection` below.
 */
export function RoleBadge({ role }: { role: LessonRole }) {
  const label = roleBadge(role);
  if (!label) return null;
  return (
    <View className="self-start rounded-tag border border-border-strong bg-surface px-1.5 py-0.5 mt-1">
      <Text className="text-label font-medium text-ink-secondary">{label}</Text>
    </View>
  );
}
