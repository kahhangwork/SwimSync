// One card per student: name, kind chip, status buttons, sub-type pickers.
// Moved VERBATIM from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6); props destructured on the first line so
// the JSX is byte-identical (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { AttState, StudentRow, TopStatus } from "../types";
import { TOP_STATUSES } from "../constants";

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
        <View className="bg-white rounded-2xl p-6 items-center border border-gray-100">
          <Text className="text-gray-400 text-sm">No students enrolled</Text>
        </View>
      ) : (
        students.map((student) => {
          const state = attendance[student.id] ?? {
            top: "unmarked",
            sub: null,
          };
          return (
            <View
              key={student.id}
              className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
            >
              {/* Student name */}
              <View className="flex-row items-center gap-3 mb-3">
                <View className="w-9 h-9 rounded-full bg-sky-100 items-center justify-center">
                  <Text className="text-sky-600 font-bold text-sm">
                    {student.full_name.charAt(0)}
                  </Text>
                </View>
                <Text className="text-sm font-semibold text-gray-800">
                  {student.full_name}
                </Text>
                {student.attendedOnly && (
                  // Not a weekly regular — say which kind. A TRIAL is
                  // someone the coach is meeting for the first time and the
                  // status they pick decides what the family is charged; a
                  // MAKE-UP is an enrolled child guesting from another class
                  // for this one lesson.
                  <View
                    className={`px-2 py-0.5 rounded-full ${
                      student.isTrial
                        ? "bg-sky-100"
                        : student.isMakeup
                          ? "bg-emerald-100"
                          : "bg-amber-100"
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-semibold ${
                        student.isTrial
                          ? "text-sky-700"
                          : student.isMakeup
                            ? "text-emerald-700"
                            : "text-amber-700"
                      }`}
                    >
                      {student.isTrial
                        ? "Trial"
                        : student.isMakeup
                          ? "Make-up"
                          : "Not enrolled"}
                    </Text>
                  </View>
                )}
              </View>

              {/* Unmarked indicator */}
              {state.top === "unmarked" && (
                <View className="flex-row items-center gap-1.5 mb-2">
                  <View className="w-2 h-2 rounded-full bg-gray-300" />
                  <Text className="text-xs text-gray-400 font-medium">
                    Not yet marked
                  </Text>
                </View>
              )}

              {/* Public-holiday void — read-only. Set by the admin; a coach
                  cannot change it (the DB guard refuses), so no buttons show. */}
              {state.top === "holiday" && (
                <View className="flex-row items-center gap-1.5 mb-1">
                  <View className="w-2 h-2 rounded-full bg-purple-400" />
                  <Text className="text-xs text-purple-500 font-medium">
                    Public holiday — no charge
                  </Text>
                </View>
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
                ).map(({ key, label, ring, bg }) => {
                  const isSelected = state.top === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      disabled={readOnly}
                      onPress={() => setTop(student.id, key)}
                      className={`flex-1 py-2 rounded-xl border-2 items-center ${
                        isSelected
                          ? `${ring} ${bg}`
                          : "border-gray-200 bg-gray-50"
                      } ${readOnly && !isSelected ? "opacity-50" : ""}`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          isSelected ? "text-white" : "text-gray-500"
                        }`}
                      >
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
                  <Text className="text-xs text-gray-500 mr-1">Reason:</Text>
                  {[
                    { key: "rain", label: "Rain" },
                    { key: "coach", label: "Coach" },
                  ].map(({ key, label }) => (
                    <TouchableOpacity
                      key={key}
                      disabled={readOnly}
                      onPress={() => setSub(student.id, key)}
                      className={`px-4 py-1.5 rounded-full border ${
                        state.sub === key
                          ? "bg-orange-500 border-orange-500"
                          : "bg-white border-gray-300"
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          state.sub === key ? "text-white" : "text-gray-600"
                        }`}
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
                  <Text className="text-xs text-gray-500 mr-1">Trial type:</Text>
                  {[
                    { key: "paid", label: "Paid" },
                    { key: "free", label: "Free" },
                  ].map(({ key, label }) => (
                    <TouchableOpacity
                      key={key}
                      disabled={readOnly}
                      onPress={() => setSub(student.id, key)}
                      className={`px-4 py-1.5 rounded-full border ${
                        state.sub === key
                          ? "bg-blue-500 border-blue-500"
                          : "bg-white border-gray-300"
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          state.sub === key ? "text-white" : "text-gray-600"
                        }`}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })
      )}
    </>
  );
}
