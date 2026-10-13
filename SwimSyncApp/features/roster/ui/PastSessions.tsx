// PastSessions — the roster screen's past sessions list (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Restyled in UI restyle step 2.4: the row's state is a status TAG on the five-step
// scale (same words and tones as the Schedule tab's chip), the row is the card.
// Nothing here may import dao/ (fence check 1).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SURFACE } from "@/components/ui/Surface";
import { Tag, type Tone } from "@/components/ui/Tag";
import { progressLabel, isFinished, type LessonProgress } from "@/lib/attendanceSummary";
import type { Session } from "@/features/roster/types";
import { formatDate } from "@/features/roster/domain/rosterFormat";

/** Nothing to mark → neutral; not or partly marked → warning; marked → success
 *  (DESIGN.md's scale; mirrors features/schedule/ui/ProgressChip). */
const PROGRESS_TONE: Record<LessonProgress["kind"], Tone> = {
  "no-students": "neutral",
  upcoming: "neutral",
  unmarked: "warning",
  partial: "warning",
  complete: "success",
};

export function PastSessions(p: {
  id: string;
  sessions: Session[];
  /** No lesson has fallen due — MarkTargetPanel (or the empty roster) already
   *  says so, so an empty list here says nothing a second time. */
  nothingToMark: boolean;
}) {
  const { id, sessions, nothingToMark } = p;
  if (sessions.length === 0 && nothingToMark) return null;
  return (
    <>
      <Text className="text-headline font-semibold text-ink mb-3">
        Past Sessions
      </Text>

      {sessions.length === 0 ? (
        <View className={`${SURFACE} items-center py-6`}>
          <Ionicons name="calendar-outline" size={32} color="#6b6b6b" />
          <Text className="text-body text-ink-secondary mt-2">
            No sessions recorded yet
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {sessions.map((session) => {
            const cancelled = session.cancelled === true;
            const complete = isFinished(session.progress);
            return (
              <TouchableOpacity
                key={session.session_date}
                onPress={() =>
                  router.push(
                    `/(coach)/classes/${id}/attendance?date=${session.session_date}&from=roster`
                  )
                }
                activeOpacity={0.8}
                className={`${SURFACE} flex-row items-center gap-3`}
              >
                <View className="flex-1 gap-1">
                  <Text
                    className={
                      cancelled
                        ? "text-body font-semibold text-ink-muted line-through"
                        : "text-body font-semibold text-ink"
                    }
                  >
                    {formatDate(session.session_date)}
                  </Text>
                  {cancelled ? (
                    <Text className="text-body-secondary text-ink-secondary">
                      Cancelled by your admin
                    </Text>
                  ) : (
                    <Tag
                      label={progressLabel(session.progress)}
                      tone={PROGRESS_TONE[session.progress.kind]}
                    />
                  )}
                  {/* Omitted entirely when nothing is recorded — never a
                      dangling separator. A cancelled lesson shows its
                      reason instead, so the coach knows why it is struck. */}
                  {session.summary ? (
                    <Text className="text-body-secondary text-ink-secondary">
                      {session.summary}
                    </Text>
                  ) : cancelled && session.cancelReason ? (
                    <Text className="text-body-secondary text-ink-secondary">
                      {session.cancelReason}
                    </Text>
                  ) : null}
                </View>
                <View className="flex-row items-center gap-1">
                  <Text className="text-body-secondary font-semibold text-primary">
                    {complete ? "Edit" : "Mark"}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color="#2563eb" />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </>
  );
}
