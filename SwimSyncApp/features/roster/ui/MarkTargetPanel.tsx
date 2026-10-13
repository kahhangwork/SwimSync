// MarkTargetPanel — the roster screen's primary Mark Attendance action (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Restyled in UI restyle step 2.4. Nothing here may import dao/ (fence check 1).
import React from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { Student } from "@/features/roster/types";
import { formatDate } from "@/features/roster/domain/rosterFormat";

export function MarkTargetPanel(p: {
  id: string;
  markTarget: { date: string } | null;
  todayDate: string;
  windowStart: string | null;
  students: Student[];
}) {
  const { id, markTarget, todayDate, windowStart, students } = p;
  // ONE empty state (UI restyle 2.4): with nobody enrolled, StudentList's card
  // says so — this panel adds nothing, and Past Sessions stays quiet too.
  if (!markTarget && students.length === 0) return null;
  return (
    // Mark attendance — the most recent expected lesson within the window.
    // No target = no lesson has fallen due yet (e.g. a brand-new class).
    <View className="mb-5">
      {markTarget ? (
        <>
          <Button
            label={`Mark Attendance — ${formatDate(markTarget.date)}${
              markTarget.date === todayDate ? " (Today)" : ""
            }`}
            onPress={() =>
              router.push(
                `/(coach)/classes/${id}/attendance?date=${markTarget.date}&from=roster`
              )
            }
          />
          {windowStart && (
            <Text className="text-body-secondary text-ink-secondary mt-2 text-center">
              You can mark lessons back to {formatDate(windowStart)}. Earlier
              lessons are closed — a correction to an already-invoiced lesson
              uses a credit note instead.
            </Text>
          )}
        </>
      ) : (
        <Surface className="items-center py-6">
          <Ionicons name="calendar-outline" size={28} color="#6b6b6b" />
          <Text className="text-body font-semibold text-ink mt-2">
            No lessons to mark yet
          </Text>
          <Text className="text-body-secondary text-ink-secondary mt-1 text-center">
            This class&apos;s first lesson hasn&apos;t taken place yet — nothing to mark.
          </Text>
        </Surface>
      )}
    </View>
  );
}
