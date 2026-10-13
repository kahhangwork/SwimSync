// What this level teaches, and the child's grades against it.
// Moved from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). UI restyle step 3.5: each grade is a tag — the top grade Success,
// any other neutral (as on the coach's Grade screen, step 2.5).
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import { Tag } from "@/components/ui/Tag";
import { summariseSkillProgress } from "@/lib/skillProgress";
import type { ChildDetail } from "../types";

export function LevelCard(p: { child: ChildDetail }) {
  const { child } = p;
  return (
    <>
      {/* What this level teaches — the clearest answer the app has to
          "what is my child working towards?", which it could not answer at
          all before. Read-only: the business's admin owns the curriculum. */}
      {child.level_label && (child.level_skills.length > 0 || child.level_note) ? (
        (() => {
          // The child's progress against the current level, paired and counted.
          const summary = summariseSkillProgress(
            child.level_skills,
            Object.entries(child.skill_grades).map(([skill_id, grade_level_id]) => ({
              skill_id,
              grade_level_id,
            })),
            child.scale
          );
          return (
            <Surface>
              <View className="flex-row items-center justify-between gap-3 mb-1">
                <Text className="text-headline font-semibold text-ink flex-1">
                  {child.level_label}
                </Text>
                {/* The headline: how many skills are at the top grade. Only
                    shown once a scale exists and there is something to count. */}
                {summary.total > 0 && summary.topGradeLabel ? (
                  <Text className="text-label font-medium text-ink-secondary" style={{ fontVariant: ["tabular-nums"] }}>
                    {summary.doneCount} of {summary.total} at {summary.topGradeLabel}
                  </Text>
                ) : null}
              </View>
              {child.level_note ? (
                <Text className="text-body-secondary text-ink-secondary mb-3">
                  {child.level_note}
                </Text>
              ) : (
                <View className="mb-3" />
              )}
              {summary.skills.length > 0 ? (
                <View className="gap-2">
                  {summary.skills.map((sk, i) => (
                    <View key={sk.id} className="flex-row items-center gap-2.5">
                      <Text className="text-body font-semibold text-ink-muted w-5" style={{ fontVariant: ["tabular-nums"] }}>
                        {i + 1}
                      </Text>
                      <Text className="text-body text-ink flex-1">{sk.label}</Text>
                      {/* The grade the coach recorded, or nothing yet. */}
                      {sk.grade ? (
                        <Tag label={sk.grade.label} tone={sk.done ? "success" : "neutral"} />
                      ) : (
                        <Text className="text-label text-ink-muted">Not yet graded</Text>
                      )}
                    </View>
                  ))}
                </View>
              ) : null}
            </Surface>
          );
        })()
      ) : null}
    </>
  );
}
