// StudentList — the roster screen's enrolled students (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Markup moved VERBATIM from app/(coach)/classes/[id]/roster.tsx: the props are
// destructured on the first line so the JSX below is byte-identical to the
// route's (playbook §2). Nothing here may import dao/ (fence check 1).
import React from "react";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import Card from "@/components/Card";
import { formatSgDate, ageFromDob } from "@/lib/lessonDates";
import type { Student } from "@/features/roster/types";

export function StudentList(p: {
  id: string;
  students: Student[];
  duplicateNames: Set<string>;
  removingId: string | null;
  handleRemove: (student: Student) => void;
  openLevelFor: string | null;
  setOpenLevelFor: (id: string | null) => void;
}) {
  const { id, students, duplicateNames, removingId, handleRemove, openLevelFor, setOpenLevelFor } = p;
  return (
    <>
        {/* Enrolled Students */}
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-base font-bold text-gray-900">
            Students ({students.length})
          </Text>
        </View>

        <View className="gap-2 mb-6">
          {students.length === 0 ? (
            <Card className="items-center py-6">
              <Text className="text-gray-400 text-sm">No students enrolled</Text>
            </Card>
          ) : (
            students.map((student) => (
              <Card key={student.id}>
               <View className="flex-row items-center gap-3">
                <View className="w-9 h-9 rounded-full bg-sky-100 items-center justify-center">
                  <Text className="text-sky-600 font-bold text-sm">
                    {student.full_name.charAt(0)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-gray-800">
                    {student.full_name}
                  </Text>
                  {/* Age is the everyday useful fact. The BIRTHDAY only appears
                      when another child on this roster shares the name — that
                      is the case the identity rule exists for, and two children
                      of the same name can easily be the same age, so age alone
                      would not tell them apart. */}
                  {(() => {
                    const age = ageFromDob(student.date_of_birth);
                    const ambiguous = duplicateNames.has(
                      student.full_name.trim().toLowerCase()
                    );
                    if (age === null && !ambiguous && !student.level_label) return null;
                    return (
                      <Text className="text-xs text-gray-500 mt-0.5">
                        {student.level_label ? `${student.level_label} · ` : ""}
                        {age !== null ? `Age ${age}` : "Age unknown"}
                        {/* WITH THE YEAR — formatSgDate's default omits it,
                            and the year is usually the only thing separating
                            two children of the same name. "born 10 Mar" would
                            render identically for both of them. */}
                        {ambiguous && student.date_of_birth
                          ? ` · born ${formatSgDate(student.date_of_birth, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : ""}
                      </Text>
                    );
                  })()}
                </View>
                {/* VIEW this child's skill grades. Read-only since
                    20260829000100 — grading moved to the admin panel's
                    Assessment tab, so the label says Skills, not Grade: the
                    coach is looking something up, not recording it. A direct
                    leaf <Text> inside the Pressable — RN-web swallows the tap
                    otherwise (§7.10-adjacent). */}
                <Pressable
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${id}/grade?studentId=${student.id}`
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200"
                >
                  <Text className="text-xs font-semibold text-sky-600">Skills</Text>
                </Pressable>
                {/* A child who has stopped coming keeps this class permanently
                    "incomplete" — every lesson expects a mark for them — and
                    that now blocks invoicing outright. This is the in-app way
                    out. */}
                <Pressable
                  onPress={() => handleRemove(student)}
                  disabled={removingId === student.id}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200"
                >
                  <Text className="text-xs font-semibold text-gray-500">
                    {removingId === student.id ? "Removing…" : "Remove"}
                  </Text>
                </Pressable>
               </View>

                {/* The level's curriculum, on tap. Collapsed by default: a
                    roster of six children on three levels would otherwise be
                    thirty lines of skills, and the coach opens the one they
                    are teaching. */}
                {student.level_label &&
                (student.level_skills.length > 0 || student.level_note) ? (
                  <Pressable
                    onPress={() =>
                      setOpenLevelFor(
                        openLevelFor === student.id ? null : student.id
                      )
                    }
                    className="mt-2 pt-2 border-t border-gray-100"
                  >
                    <Text className="text-xs font-medium text-sky-600">
                      {openLevelFor === student.id ? "Hide" : "What"}{" "}
                      {student.level_label} {openLevelFor === student.id ? "" : "covers"}
                    </Text>
                  </Pressable>
                ) : null}

                {openLevelFor === student.id ? (
                  <View className="mt-2 gap-1.5">
                    {student.level_note ? (
                      <Text className="text-xs italic text-gray-500 mb-1">
                        {student.level_note}
                      </Text>
                    ) : null}
                    {student.level_skills.map((skill, i) => (
                      <View key={`${skill}-${i}`} className="flex-row gap-2">
                        <Text className="text-xs text-sky-500 font-semibold w-3.5">
                          {i + 1}
                        </Text>
                        <Text className="text-xs text-gray-700 flex-1">{skill}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </View>

    </>
  );
}
