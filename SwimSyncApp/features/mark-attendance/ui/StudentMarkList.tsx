// One card per student: name, kind, the card's tag, status buttons, sub-type pickers.
// Moved from app/(coach)/classes/[id]/attendance.tsx (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stage 6); restyled to DESIGN.md in UI restyle step 2.2 — what each press reports is
// unchanged.
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Surface } from "@/components/ui/Surface";
import { Tag } from "@/components/ui/Tag";
import { statusTone } from "@/lib/statusTone";
import type { AttState, StudentRow, TopStatus } from "../types";
import { SEGMENT_BOX, SEGMENT_LABEL, TOP_STATUSES } from "../constants";

/** A sub-type choice (Rain/Coach, Paid/Free): the Selected fill when chosen. */
const SUB_BOX = "min-h-11 px-4 rounded-control border items-center justify-center";
const SUB_CHOSEN = `${SUB_BOX} bg-selected border-ink`;
const SUB_IDLE = `${SUB_BOX} bg-surface border-border-strong`;

export default function StudentMarkList(p: {
  students: StudentRow[];
  attendance: Record<string, AttState>;
  readOnly: boolean;
  setTop: (studentId: string, top: TopStatus) => void;
  setSub: (studentId: string, sub: string) => void;
}) {
  const { students, attendance, readOnly, setTop, setSub } = p;
  return (
    <>
      {students.length === 0 ? (
        <Surface className="items-center">
          <Text className="text-body text-ink-secondary">No students enrolled</Text>
        </Surface>
      ) : (
        students.map((student) => {
          const state = attendance[student.id] ?? {
            top: "unmarked",
            sub: null,
          };
          return (
            <Surface key={student.id}>
              {/* Name, kind, and the card's one tag (top-right). The tag says
                  what still needs doing — "Not marked" — never the chosen
                  word: a second "Present" leaf on the card would be pressed by
                  the drivers' index-based pressByText in place of the next
                  child's button. The chosen word shows on its own button. */}
              <View className="flex-row items-start gap-2 mb-3">
                <View className="flex-1">
                  <Text className="text-body font-semibold text-ink">
                    {student.full_name}
                  </Text>
                  {student.attendedOnly && (
                    // Not a weekly regular — say which kind. A TRIAL is
                    // someone the coach is meeting for the first time and the
                    // status they pick decides what the family is charged; a
                    // MAKE-UP is an enrolled child guesting from another class
                    // for this one lesson.
                    <Text className="text-body-secondary text-ink-secondary">
                      {student.isTrial
                        ? "Trial"
                        : student.isMakeup
                          ? "Make-up"
                          : "Not enrolled"}
                    </Text>
                  )}
                </View>
                {state.top === "unmarked" && (
                  <Tag label="Not marked" tone={statusTone("Not marked")} />
                )}
                {state.top === "holiday" && (
                  <Tag label="Public Holiday" tone={statusTone("Public Holiday")} />
                )}
              </View>

              {/* Public-holiday void — read-only. Set by the admin; a coach
                  cannot change it (the DB guard refuses), so no buttons show. */}
              {state.top === "holiday" && (
                <Text className="text-body-secondary text-ink-secondary">
                  Public holiday — no charge
                </Text>
              )}

              {/* Top-level status buttons. A make-up guest gets the ordinary
                  statuses only: the trial statuses price by the trial rate,
                  and a make-up is not a trial. Affordance, not the guard —
                  the engine prices a mismark at the class rate. Hidden for a
                  holiday row, which is read-only. */}
              {state.top !== "holiday" && (
              <View className="flex-row gap-2">
                {TOP_STATUSES.filter(
                  ({ key }) => !(student.isMakeup && key === "trial")
                ).map(({ key, label }) => {
                  const isSelected = state.top === key;
                  const tone = statusTone(label);
                  return (
                    <TouchableOpacity
                      key={key}
                      disabled={readOnly}
                      onPress={() => setTop(student.id, key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected, disabled: readOnly }}
                      aria-pressed={isSelected}
                      className={`${SEGMENT_BOX[isSelected ? tone : "idle"]} ${
                        readOnly && !isSelected ? "opacity-50" : ""
                      }`}
                    >
                      {/* The word is the touchable's DIRECT child — pressByText
                          dispatches on the matched leaf's parent (§7.365). */}
                      <Text className={SEGMENT_LABEL[isSelected ? tone : "idle"]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              )}

              {/* Cancelled sub-type */}
              {state.top === "cancelled" && (
                <View className="mt-3 flex-row gap-2 items-center">
                  <Text className="text-body-secondary text-ink-secondary mr-1">Reason:</Text>
                  {[
                    { key: "rain", label: "Rain" },
                    { key: "coach", label: "Coach" },
                  ].map(({ key, label }) => (
                    <TouchableOpacity
                      key={key}
                      disabled={readOnly}
                      onPress={() => setSub(student.id, key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: state.sub === key, disabled: readOnly }}
                      aria-pressed={state.sub === key}
                      className={state.sub === key ? SUB_CHOSEN : SUB_IDLE}
                    >
                      <Text
                        className={
                          state.sub === key
                            ? "text-body font-semibold text-ink"
                            : "text-body font-medium text-ink-secondary"
                        }
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Trial sub-type */}
              {state.top === "trial" && (
                <View className="mt-3 flex-row gap-2 items-center">
                  <Text className="text-body-secondary text-ink-secondary mr-1">Trial type:</Text>
                  {[
                    { key: "paid", label: "Paid" },
                    { key: "free", label: "Free" },
                  ].map(({ key, label }) => (
                    <TouchableOpacity
                      key={key}
                      disabled={readOnly}
                      onPress={() => setSub(student.id, key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: state.sub === key, disabled: readOnly }}
                      aria-pressed={state.sub === key}
                      className={state.sub === key ? SUB_CHOSEN : SUB_IDLE}
                    >
                      <Text
                        className={
                          state.sub === key
                            ? "text-body font-semibold text-ink"
                            : "text-body font-medium text-ink-secondary"
                        }
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </Surface>
          );
        })
      )}
    </>
  );
}
