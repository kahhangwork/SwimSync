// What this level teaches, and the child's grades against it.
// Moved VERBATIM from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import Card from "@/components/Card";
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
            <Card>
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-base font-bold text-gray-900">
                  {child.level_label}
                </Text>
                {/* The headline: how many skills are at the top grade. Only
                    shown once a scale exists and there is something to count. */}
                {summary.total > 0 && summary.topGradeLabel ? (
                  <Text className="text-xs font-semibold text-gray-500">
                    {summary.doneCount} of {summary.total} at {summary.topGradeLabel}
                  </Text>
                ) : null}
              </View>
              {child.level_note ? (
                <Text className="text-xs italic text-gray-500 mb-3">
                  {child.level_note}
                </Text>
              ) : (
                <View className="mb-3" />
              )}
              {summary.skills.length > 0 ? (
                <View className="gap-2">
                  {summary.skills.map((sk, i) => (
                    <View key={sk.id} className="flex-row items-center gap-2.5">
                      <Text className="text-sky-500 font-semibold text-sm w-4">
                        {i + 1}
                      </Text>
                      <Text className="text-sm text-gray-700 flex-1">{sk.label}</Text>
                      {/* The grade the coach recorded, or nothing yet. */}
                      {sk.grade ? (
                        <View
                          className={
                            "px-2.5 py-1 rounded-full " +
                            (sk.done ? "bg-green-100" : "bg-sky-100")
                          }
                        >
                          <Text
                            className={
                              "text-xs font-semibold " +
                              (sk.done ? "text-green-700" : "text-sky-700")
                            }
                          >
                            {sk.grade.label}
                          </Text>
                        </View>
                      ) : (
                        <Text className="text-xs text-gray-300">Not yet graded</Text>
                      )}
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })()
      ) : null}
    </>
  );
}
