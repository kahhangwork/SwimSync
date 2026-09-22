// The shadows' presence ticks — pre-ticked; a row in session_coach_absences means ABSENT.
// Moved VERBATIM from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6); props destructured on the first line so
// the JSX is byte-identical (whitespace aside).
import React from "react";
import type { Dispatch, SetStateAction } from "react";
import { View, Text, TouchableOpacity } from "react-native";

export default function CoachesPresent(p: {
  readOnly: boolean;
  shadowsHere: { coach_id: string; name: string; present: boolean }[];
  setShadowsHere: Dispatch<SetStateAction<{ coach_id: string; name: string; present: boolean }[]>>;
}) {
  const { readOnly, shadowsHere, setShadowsHere } = p;
  return (
    <>
      {/* ── Coaches present ────────────────────────────────────────────
          Renders NOTHING when the class has no shadows, so a business that
          has never assigned one gains no new furniture on its screens.

          Pre-ticked on purpose. The failure mode of a blank list is a coach
          who forgets and silently costs a trainee their pay, which appears
          nowhere; the failure mode of a pre-ticked one is an overpayment,
          which appears as a line on the Wages page and can be seen. */}
      {!readOnly && shadowsHere.length > 0 && (
        <View className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <Text className="text-sm font-semibold text-gray-900">
            Coaches present
          </Text>
          <Text className="mt-0.5 text-xs text-gray-500">
            Untick anyone who wasn&apos;t here — they won&apos;t be paid for
            this lesson.
          </Text>
          {shadowsHere.map((sh) => (
            <TouchableOpacity
              key={sh.coach_id}
              onPress={() =>
                setShadowsHere((prev) =>
                  prev.map((x) =>
                    x.coach_id === sh.coach_id
                      ? { ...x, present: !x.present }
                      : x
                  )
                )
              }
              className="mt-3 flex-row items-center"
            >
              <View
                className={`h-5 w-5 items-center justify-center rounded border ${
                  sh.present
                    ? "bg-blue-500 border-blue-500"
                    : "bg-white border-gray-300"
                }`}
              >
                {sh.present && (
                  <Text className="text-xs font-bold text-white">✓</Text>
                )}
              </View>
              {/* ⚠ THE NAME IS ITS OWN LEAF <Text>, DIRECTLY INSIDE THE
                  TOUCHABLE. RN-web puts the press handler on the Pressable and
                  a click on a nested Text child is swallowed silently — the
                  same trap every marking driver in this repo works around. A
                  name wrapped in an outer Text with a sibling span is not a
                  leaf at all, so it cannot be pressed by text and the tick
                  becomes untestable. */}
              <Text
                className={`ml-2.5 text-sm ${
                  sh.present ? "text-gray-900" : "text-gray-400"
                }`}
              >
                {sh.name}
              </Text>
              <Text className="ml-1 text-xs text-gray-400">· shadowing</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );
}
