// Needs marking — the floor-scoped backlog, as DESIGN.md's billing blocker.
import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { progressLabel } from "@/lib/attendanceSummary";
import { blockedMonths, dayHeading } from "../domain/scheduleFormat";
import { ScheduleButton } from "./ScheduleButton";
import type { useScheduleSections } from "../domain/useScheduleSections";

type Sections = ReturnType<typeof useScheduleSections>;

/** Above this many rows the list folds to the first COLLAPSED_ROWS, so TODAY is
 *  not pushed off the screen by a long backlog. The driver fixtures hold 1–2
 *  rows, so they always see the whole list. */
const FOLD_ABOVE = 5;
const COLLAPSED_ROWS = 3;

/**
 * DESIGN.md's Blocker-Outranks-Routine rule: an unmarked past lesson blocks its
 * month from billing with NO override (§8a), so it is the loudest thing on the
 * screen — a Danger container above TODAY, the consequence in words, and the
 * screen's one primary button. A routine lesson happening now does not outrank it
 * (TodaySection's buttons go secondary while this shows).
 */
export function NeedsMarkingSection(p: Pick<Sections, "visibleNeedsMarking" | "openAttendance">) {
  const { visibleNeedsMarking, openAttendance } = p;
  const [showAll, setShowAll] = useState(false);
  if (visibleNeedsMarking.length === 0) return null;

  const folds = visibleNeedsMarking.length > FOLD_ABOVE;
  const rows = folds && !showAll ? visibleNeedsMarking.slice(0, COLLAPSED_ROWS) : visibleNeedsMarking;
  // Most recent first (scheduleRows.ts), so the oldest — the month that blocks
  // the rest — is the last row.
  const oldest = visibleNeedsMarking[visibleNeedsMarking.length - 1];
  const open = (item: (typeof visibleNeedsMarking)[number]) =>
    openAttendance({ classId: item.class_id, date: item.date, sessionId: item.session_id });

  return (
    <View className="mb-5 bg-status-danger-bg border border-status-danger-border rounded-card p-4">
      {/* ⚠ THE HEADING STRING IS `Needs marking (N)` AND THE COUNT IS PART OF
          IT. Several drivers assert on it verbatim, and the parenthesised number
          is the only assertion that the floor-scoped set is neither larger nor
          smaller than it should be. Do not relax those regexes to a bare
          /Needs marking/. Keep this string UNIQUE on the screen too — a negative
          assertion elsewhere (`!/Needs marking/`) false-fails if the words
          appear twice. N is the WHOLE set, folded rows included. */}
      <Text className="text-headline font-semibold text-status-danger-text">
        Needs marking ({visibleNeedsMarking.length})
      </Text>
      <Text className="text-body text-ink mt-1">
        {blockedMonths(visibleNeedsMarking.map((i) => i.date))} can&apos;t be billed until
        these lessons are marked.
      </Text>

      <ScheduleButton label="Mark oldest lesson" onPress={() => open(oldest)} className="mt-3" />

      <View className="gap-2 mt-3">
        {rows.map((item) => (
          <TouchableOpacity
            key={`${item.class_id}:${item.date}`}
            onPress={() => open(item)}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <View className="flex-row items-center gap-3 bg-surface border border-border rounded-card px-4 py-3 min-h-11">
              <View className="flex-1">
                <Text className="text-body font-semibold text-ink">{item.class_title}</Text>
                <Text className="text-body-secondary text-ink-secondary">
                  {dayHeading(item.date)}
                </Text>
                <Text className="text-body-secondary text-ink-secondary">
                  {progressLabel(item.progress)}
                  {item.summary ? ` · ${item.summary}` : ""}
                </Text>
              </View>
              {/* "Mark" stays a LEAF text with this exact string: two drivers
                  press it with pressByText(page, "Mark"), which dispatches on
                  its parent and bubbles to the row's Touchable. */}
              <View className="flex-row items-center gap-1">
                <Text className="text-body font-semibold text-primary">Mark</Text>
                <Ionicons name="chevron-forward" size={14} color="#2563eb" />
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {folds && (
        <TouchableOpacity
          onPress={() => setShowAll(!showAll)}
          className="min-h-11 justify-center mt-1"
          accessibilityRole="button"
        >
          <Text className="text-body font-semibold text-primary">
            {showAll ? "Show fewer" : `Show all ${visibleNeedsMarking.length}`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
