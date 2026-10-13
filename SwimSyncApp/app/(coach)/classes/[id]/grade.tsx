// The coach VIEWS one child's grades against the skills of their CURRENT level.
//
// READ-ONLY SINCE 20260829000100, AND THAT IS THE POINT OF THE SCREEN.
// Grading moved to the admin panel's Assessment tab: it is an administrative
// record the business controls, not a per-coach act. The database enforces it —
// student_skill_progress' write policy is admin-only — so this screen could not
// write even if it tried. What remains is genuinely useful: a coach mid-lesson
// wants to know where a child is, and that answer lives here.
//
// The screen is therefore a pure reader. There is deliberately no tap handler,
// no optimistic state and no Toast, because there is no write that could fail.
// If grading ever returns to the coach app, restore the write path from git
// history rather than re-deriving it — the upsert carried an onConflict key
// (student_id, skill_id) that is easy to get wrong.
//
// The n-of-m summary is pure (lib/skillProgress.ts, tested in jest). "Done" =
// the top grade, computed every render, never stored — adding a higher grade
// re-opens a skill (mirrors the migration).

import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { Tag } from "@/components/ui/Tag";
import { useStudentGrades } from "@/features/grade/domain/useStudentGrades";

// The load and the n-of-m summary live in features/grade/domain/useStudentGrades
// (docs/refactor/BATCH_FGH_PLAN.md, app fence); the markup stays here.

export default function StudentSkillsScreen() {
  const { loading, student, skills, scale, loadData, summary } = useStudentGrades();

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-ground items-center justify-center">
        <ActivityIndicator size="large" color="#2563eb" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-ground">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="Back"
          className="w-11 h-11 -ml-3 items-center justify-center"
        >
          <Ionicons name="chevron-back" size={24} color="#0a0a0a" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-display font-semibold text-ink">
            {student?.full_name ?? "Skills"}
          </Text>
          {student?.level_label ? (
            <Text className="text-body-secondary text-ink-secondary">
              {student.level_label}
              {summary.total > 0
                ? ` · ${summary.doneCount} of ${summary.total}${
                    summary.topGradeLabel ? ` at ${summary.topGradeLabel}` : ""
                  }`
                : ""}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 32 }}>
        {!student ? (
          <Surface className="items-center py-8">
            <Ionicons name="alert-circle-outline" size={32} color="#6b6b6b" />
            <Text className="text-body text-ink-secondary mt-2">Could not load this child.</Text>
          </Surface>
        ) : !student.level_label ? (
          // Unlevelled children are common — a deleted level SET-NULLs the child,
          // and a cross-business move nulls it too. Say so plainly; there is
          // nothing to grade until an admin sets a level.
          <Surface className="items-center py-8">
            <Ionicons name="school-outline" size={32} color="#6b6b6b" />
            <Text className="text-body font-semibold text-ink mt-2">No level set</Text>
            <Text className="text-body-secondary text-ink-secondary mt-1 text-center px-4">
              This child has no swimming level yet, so there are no skills to grade.
              An admin sets a level from the Students page.
            </Text>
          </Surface>
        ) : skills.length === 0 ? (
          <Surface className="items-center py-8">
            <Ionicons name="list-outline" size={32} color="#6b6b6b" />
            <Text className="text-body font-semibold text-ink mt-2">
              No skills listed
            </Text>
            <Text className="text-body-secondary text-ink-secondary mt-1 text-center px-4">
              {student.level_label} has no skills yet. An admin adds them from the
              Levels page.
            </Text>
          </Surface>
        ) : (
          <>
            {student.level_note ? (
              <Text className="text-body-secondary italic text-ink-secondary mb-3">{student.level_note}</Text>
            ) : null}
            {/* Says WHY there is nothing to tap. Without this the screen reads
                as broken to a coach who graded here last month. */}
            <Text className="text-body-secondary text-ink-secondary mb-3">
              Grades are set by an admin
              {scale.length > 0 ? ` (${scale.map((g) => g.label).join(" → ")})` : ""}.
            </Text>
            <View className="gap-2">
              {summary.skills.map((sk, i) => (
                <Surface key={sk.id}>
                  <View className="flex-row items-center gap-3">
                    <Text className="text-body-secondary font-semibold text-ink-muted w-4">{i + 1}</Text>
                    <Text className="text-body text-ink flex-1">{sk.label}</Text>
                    {/* The grade as a tag: the top grade is done (success); any
                        other grade, or none yet, is neutral — the word says which. */}
                    <Tag
                      label={sk.grade ? sk.grade.label : "Not yet graded"}
                      tone={sk.done ? "success" : "neutral"}
                    />
                  </View>
                </Surface>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
