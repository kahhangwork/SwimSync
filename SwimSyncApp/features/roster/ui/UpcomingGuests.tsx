// UpcomingGuests — the roster screen's trials / make-ups / extra lessons coming up (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Markup moved VERBATIM from app/(coach)/classes/[id]/roster.tsx: the props are
// destructured on the first line so the JSX below is byte-identical to the
// route's (playbook §2). Nothing here may import dao/ (fence check 1).
import React from "react";
import { View, Text } from "react-native";
import { formatSgDate } from "@/lib/lessonDates";
import type { Guest, Extra } from "@/features/roster/types";

export function UpcomingGuests(p: {
  upcomingTrials: Guest[];
  upcomingMakeups: Guest[];
  upcomingExtras: Extra[];
}) {
  const { upcomingTrials, upcomingMakeups, upcomingExtras } = p;
  return (
    <>
        {/* ── Trials coming up ─────────────────────────────────────────────
            Listed ABOVE the roster because it is the thing the coach does not
            already know. They are guests for one lesson, not members, so they
            are deliberately a separate list rather than mixed into the roster —
            mixing them would imply a weekly student. */}
        {upcomingTrials.length > 0 && (
          <View className="mb-5 bg-sky-50 rounded-2xl p-4 border border-sky-100">
            <Text className="text-sm font-bold text-sky-900">
              Trial{upcomingTrials.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingTrials.map((tr) => (
              <View
                key={`${tr.id}-${tr.session_date}`}
                className="mt-2 flex-row items-center justify-between"
              >
                <Text className="text-sm text-sky-900">{tr.full_name}</Text>
                <Text className="text-xs font-medium text-sky-700">
                  {formatSgDate(tr.session_date)}
                </Text>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-sky-700">
              Trying one lesson — mark them like anyone else on the day.
            </Text>
          </View>
        )}

        {/* ── Make-ups coming up ───────────────────────────────────────────
            An enrolled child from another class of the same kind, guesting
            for one lesson. Separate from trials because the coach's job
            differs: a make-up child is not new to the business, and the
            ordinary statuses apply — there is nothing to sell. */}
        {upcomingMakeups.length > 0 && (
          <View className="mb-5 bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
            <Text className="text-sm font-bold text-emerald-900">
              Make-up{upcomingMakeups.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingMakeups.map((mk) => (
              <View
                key={`${mk.id}-${mk.session_date}`}
                className="mt-2 flex-row items-center justify-between"
              >
                <Text className="text-sm text-emerald-900">{mk.full_name}</Text>
                <Text className="text-xs font-medium text-emerald-700">
                  {formatSgDate(mk.session_date)}
                </Text>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-emerald-700">
              Joining this one lesson as a make-up — mark them like anyone
              else on the day.
            </Text>
          </View>
        )}

        {/* ── Extra lessons coming up ──────────────────────────────────────
            A lesson on a day this class does not normally run, arranged by the
            business's admin. Shown here for the same reason trials are: it is
            the thing the coach does not already know, and their weekday-based
            expectation of this class will not produce it. */}
        {upcomingExtras.length > 0 && (
          <View className="mb-5 bg-amber-50 rounded-2xl p-4 border border-amber-100">
            <Text className="text-sm font-bold text-amber-900">
              Extra lesson{upcomingExtras.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingExtras.map((ex) => (
              <View key={ex.id} className="mt-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm text-amber-900">{ex.reason}</Text>
                  <Text className="text-xs font-medium text-amber-700">
                    {formatSgDate(ex.session_date)}
                  </Text>
                </View>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-amber-700">
              Not this class's usual day — mark it as normal once it has taken
              place.
            </Text>
          </View>
        )}

    </>
  );
}
