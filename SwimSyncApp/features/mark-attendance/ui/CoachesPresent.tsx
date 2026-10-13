// The shadows' presence ticks — pre-ticked; a row in session_coach_absences means ABSENT.
// Moved from app/(coach)/classes/[id]/attendance.tsx
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6); restyled in UI restyle step 2.2.
import React from "react";
import type { Dispatch, SetStateAction } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Surface } from "@/components/ui/Surface";

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
        <Surface className="mt-2">
          <Text className="text-headline font-semibold text-ink">
            Coaches present
          </Text>
          <Text className="mt-0.5 text-body-secondary text-ink-secondary">
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
              className="mt-1 min-h-11 flex-row items-center"
            >
              <View
                className={
                  sh.present
                    ? "h-5 w-5 items-center justify-center rounded-tag border bg-ink border-ink"
                    : "h-5 w-5 items-center justify-center rounded-tag border bg-surface border-border-strong"
                }
              >
                {sh.present && (
                  <Text className="text-label font-semibold text-white">✓</Text>
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
                className={
                  sh.present ? "ml-2.5 text-body text-ink" : "ml-2.5 text-body text-ink-muted"
                }
              >
                {sh.name}
              </Text>
              <Text className="ml-1 text-label text-ink-muted">· shadowing</Text>
            </TouchableOpacity>
          ))}
        </Surface>
      )}
    </>
  );
}
