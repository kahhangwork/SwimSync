// MarkTargetPanel — the roster screen's primary Mark Attendance action (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Markup moved VERBATIM from app/(coach)/classes/[id]/roster.tsx: the props are
// destructured on the first line so the JSX below is byte-identical to the
// route's (playbook §2). Nothing here may import dao/ (fence check 1).
import React from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";
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
  return (
    <>
        {/* Mark attendance — the most recent expected lesson within the window.
            No target = no lesson has fallen due yet (e.g. a brand-new class). */}
        <View className="mb-5">
          {markTarget ? (
            <>
              <PrimaryButton
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
                <Text className="text-xs text-gray-400 mt-2 text-center">
                  You can mark lessons back to {formatDate(windowStart)}. Earlier
                  lessons are closed — a correction to an already-invoiced lesson
                  uses a credit note instead.
                </Text>
              )}
            </>
          ) : (
            <Card className="items-center py-6 border-sky-100 bg-sky-50">
              <Ionicons name="calendar-outline" size={28} color="#7dd3fc" />
              <Text className="text-gray-600 font-semibold mt-2">
                No lessons to mark yet
              </Text>
              <Text className="text-xs text-gray-500 mt-1 text-center">
                {students.length === 0
                  ? "Assign students to this class first."
                  : "This class's first lesson hasn't taken place yet — nothing to mark."}
              </Text>
            </Card>
          )}
        </View>

    </>
  );
}
