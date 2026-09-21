// PastSessions — the roster screen's past sessions list (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Markup moved VERBATIM from app/(coach)/classes/[id]/roster.tsx: the props are
// destructured on the first line so the JSX below is byte-identical to the
// route's (playbook §2). Nothing here may import dao/ (fence check 1).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
import { progressLabel, isFinished } from "@/lib/attendanceSummary";
import type { Session } from "@/features/roster/types";
import { formatDate } from "@/features/roster/domain/rosterFormat";

export function PastSessions(p: {
  id: string;
  sessions: Session[];
}) {
  const { id, sessions } = p;
  return (
    <>
        {/* Past Sessions */}
        <Text className="text-base font-bold text-gray-900 mb-3">
          Past Sessions
        </Text>

        {sessions.length === 0 ? (
          <Card className="items-center py-6">
            <Ionicons name="calendar-outline" size={32} color="#d1d5db" />
            <Text className="text-gray-400 mt-2 text-sm">
              No sessions recorded yet
            </Text>
          </Card>
        ) : (
          <View className="gap-2">
            {sessions.map((session) => {
              const cancelled = session.cancelled === true;
              const complete = isFinished(session.progress);
              const unmarked = session.id === null;
              return (
                <TouchableOpacity
                  key={session.session_date}
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${id}/attendance?date=${session.session_date}&from=roster`
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Card
                    className={`flex-row items-center gap-3 ${
                      cancelled
                        ? "opacity-60"
                        : unmarked
                        ? "border-orange-200 bg-orange-50"
                        : ""
                    }`}
                  >
                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center ${
                        cancelled
                          ? "bg-gray-100"
                          : complete
                          ? "bg-green-100"
                          : "bg-orange-100"
                      }`}
                    >
                      <Ionicons
                        name={cancelled ? "close" : complete ? "checkmark" : "alert"}
                        size={18}
                        color={cancelled ? "#6b7280" : complete ? "#16a34a" : "#ea580c"}
                      />
                    </View>
                    <View className="flex-1">
                      <Text
                        className={`text-sm font-semibold ${
                          cancelled ? "text-gray-500 line-through" : "text-gray-800"
                        }`}
                      >
                        {formatDate(session.session_date)}
                      </Text>
                      <Text
                        className={`text-xs ${
                          cancelled
                            ? "text-gray-500"
                            : complete
                            ? "text-green-600"
                            : "text-orange-500"
                        }`}
                      >
                        {cancelled
                          ? "Cancelled by your admin"
                          : progressLabel(session.progress)}
                      </Text>
                      {/* Omitted entirely when nothing is recorded — never a
                          dangling separator. A cancelled lesson shows its
                          reason instead, so the coach knows why it is struck. */}
                      {session.summary ? (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {session.summary}
                        </Text>
                      ) : cancelled && session.cancelReason ? (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {session.cancelReason}
                        </Text>
                      ) : null}
                    </View>
                    <View className="flex-row items-center gap-1">
                      <Text className="text-xs text-sky-500">
                        {complete ? "Edit" : "Mark"}
                      </Text>
                      <Ionicons name="chevron-forward" size={13} color="#0ea5e9" />
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
    </>
  );
}
