// Coach grades one child against the skills of their CURRENT level.
//
// Reached from the class roster ("Grade"). A dedicated screen, not an inline
// roster expansion, because grading is a focused write task and the roster is
// otherwise read-only — mixing the two invites a mis-tap on a screen the coach
// scans quickly.
//
// The grade cycle and the n-of-m summary are pure (lib/skillProgress.ts, tested
// in jest). This screen is the thin shell: fetch, render, persist. "Done" = the
// top grade, computed every render, never stored — adding a higher grade
// re-opens a skill (mirrors the migration).
//
// EVERY failure surfaces via Toast, never Alert.alert — that is a silent no-op
// on RN-web (CLAUDE.md). Writes are optimistic and roll back on error.

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import Card from "@/components/Card";
import { useAppStore } from "@/store/useAppStore";
import {
  summariseSkillProgress,
  cycleGrade,
  type GradeLevel,
  type LevelSkill,
} from "@/lib/skillProgress";

type StudentInfo = {
  full_name: string;
  tenant_id: string;
  level_label: string | null;
  level_note: string | null;
};

export default function GradeStudentScreen() {
  const { id, studentId } = useLocalSearchParams<{ id: string; studentId: string }>();
  const showToast = useAppStore((s) => s.showToast);

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [skills, setSkills] = useState<LevelSkill[]>([]);
  const [scale, setScale] = useState<GradeLevel[]>([]);
  // skill_id → grade_level_id for every graded skill.
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [savingSkill, setSavingSkill] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: s } = await supabase
      .from("students")
      .select(
        "full_name, tenant_id, tenant_levels(label, note, tenant_level_skills(id, label, sort_order))"
      )
      .eq("id", studentId)
      .single();

    if (!s) {
      setStudent(null);
      setLoading(false);
      return;
    }

    // PostgREST returns the to-one tenant_levels embed as an object; the
    // generated types widen it to an array, so cast rather than index (§7.28).
    const level = (s as any).tenant_levels;
    setStudent({
      full_name: (s as any).full_name,
      tenant_id: (s as any).tenant_id,
      level_label: level?.label ?? null,
      level_note: level?.note ?? null,
    });
    setSkills(
      [...((level?.tenant_level_skills as LevelSkill[]) ?? [])].map((sk: any) => ({
        id: sk.id,
        label: sk.label,
        sort_order: sk.sort_order,
      }))
    );

    // The tenant's grade scale, and this child's existing grades. Both scoped
    // by RLS to the coach's own business already; the tenant filter is belt-and-
    // braces and makes the query self-documenting.
    const [{ data: scaleRows }, { data: progressRows }] = await Promise.all([
      supabase
        .from("skill_grade_levels")
        .select("id, rank, label")
        .eq("tenant_id", (s as any).tenant_id)
        .order("rank"),
      supabase
        .from("student_skill_progress")
        .select("skill_id, grade_level_id")
        .eq("student_id", studentId),
    ]);

    setScale((scaleRows as GradeLevel[]) ?? []);
    setGrades(
      Object.fromEntries(
        ((progressRows as any[]) ?? []).map((p) => [p.skill_id, p.grade_level_id])
      )
    );
    setLoading(false);
  }, [studentId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  async function onTapSkill(skillId: string) {
    if (!student || savingSkill) return;
    const currentGradeId = grades[skillId] ?? null;
    const current = currentGradeId ? scale.find((g) => g.id === currentGradeId) ?? null : null;
    const next = cycleGrade(current, scale);

    // Optimistic: reflect the tap immediately, then persist.
    const prevGrades = grades;
    setGrades((g) => {
      const copy = { ...g };
      if (next) copy[skillId] = next.id;
      else delete copy[skillId];
      return copy;
    });
    setSavingSkill(skillId);

    const { error } = next
      ? await supabase.from("student_skill_progress").upsert(
          {
            tenant_id: student.tenant_id,
            student_id: studentId,
            skill_id: skillId,
            grade_level_id: next.id,
          },
          { onConflict: "student_id,skill_id" }
        )
      : await supabase
          .from("student_skill_progress")
          .delete()
          .eq("student_id", studentId)
          .eq("skill_id", skillId);

    setSavingSkill(null);
    if (error) {
      setGrades(prevGrades); // roll back the optimistic change
      showToast("Could not save that grade. Try again.", "error");
    }
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  const summary = summariseSkillProgress(
    skills,
    Object.entries(grades).map(([skill_id, grade_level_id]) => ({ skill_id, grade_level_id })),
    scale
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {student?.full_name ?? "Grade skills"}
          </Text>
          {student?.level_label ? (
            <Text className="text-xs text-gray-500">
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
          <Card className="items-center py-8">
            <Ionicons name="alert-circle-outline" size={32} color="#d1d5db" />
            <Text className="text-sm text-gray-500 mt-2">Could not load this child.</Text>
          </Card>
        ) : !student.level_label ? (
          // Unlevelled children are common — a deleted level SET-NULLs the child,
          // and a cross-business move nulls it too. Say so plainly; there is
          // nothing to grade until an admin sets a level.
          <Card className="items-center py-8">
            <Ionicons name="school-outline" size={32} color="#d1d5db" />
            <Text className="text-sm font-semibold text-gray-700 mt-2">No level set</Text>
            <Text className="text-xs text-gray-500 mt-1 text-center px-4">
              This child has no swimming level yet, so there are no skills to grade.
              An admin sets a level from the Students page.
            </Text>
          </Card>
        ) : skills.length === 0 ? (
          <Card className="items-center py-8">
            <Ionicons name="list-outline" size={32} color="#d1d5db" />
            <Text className="text-sm font-semibold text-gray-700 mt-2">
              No skills listed
            </Text>
            <Text className="text-xs text-gray-500 mt-1 text-center px-4">
              {student.level_label} has no skills yet. An admin adds them from the
              Levels page.
            </Text>
          </Card>
        ) : (
          <>
            {student.level_note ? (
              <Text className="text-xs italic text-gray-500 mb-3">{student.level_note}</Text>
            ) : null}
            <Text className="text-xs text-gray-500 mb-3">
              Tap a skill to cycle its grade
              {scale.length > 0 ? ` (${scale.map((g) => g.label).join(" → ")} → not set)` : ""}.
            </Text>
            <View className="gap-2">
              {summary.skills.map((sk, i) => (
                <Pressable key={sk.id} onPress={() => onTapSkill(sk.id)}>
                  <Card>
                    <View className="flex-row items-center gap-3">
                      <Text className="text-xs text-sky-500 font-semibold w-4">{i + 1}</Text>
                      <Text className="text-sm text-gray-800 flex-1">{sk.label}</Text>
                      {/* The grade chip. A direct leaf <Text> so RN-web fires
                          the parent Pressable's onPress. */}
                      <View
                        className={
                          "px-3 py-1.5 rounded-full " +
                          (savingSkill === sk.id
                            ? "bg-gray-100"
                            : sk.done
                            ? "bg-green-100"
                            : sk.grade
                            ? "bg-sky-100"
                            : "bg-gray-100")
                        }
                      >
                        <Text
                          className={
                            "text-xs font-semibold " +
                            (sk.done
                              ? "text-green-700"
                              : sk.grade
                              ? "text-sky-700"
                              : "text-gray-400")
                          }
                        >
                          {savingSkill === sk.id
                            ? "Saving…"
                            : sk.grade
                            ? sk.grade.label
                            : "Tap to grade"}
                        </Text>
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
