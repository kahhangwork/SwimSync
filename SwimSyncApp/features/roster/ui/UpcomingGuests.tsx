// UpcomingGuests — the roster screen's trials / make-ups / extra lessons coming up (COACH_ROSTER_REFACTOR_PLAN.md, Stage 5).
// Restyled in UI restyle step 2.4: three flat cards, one look — none of them is a
// status, so none of them takes a status colour. Nothing here may import dao/.
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import { formatSgDate } from "@/lib/lessonDates";
import type { Guest, Extra } from "@/features/roster/types";

function Panel(p: { title: string; rows: { key: string; name: string; date: string }[]; note: string }) {
  return (
    <Surface className="mb-5">
      <Text className="text-body font-semibold text-ink">{p.title}</Text>
      {p.rows.map((r) => (
        <View key={r.key} className="mt-2 flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-body text-ink">{r.name}</Text>
          <Text className="text-body-secondary text-ink-secondary">{r.date}</Text>
        </View>
      ))}
      <Text className="mt-2 text-body-secondary text-ink-secondary">{p.note}</Text>
    </Surface>
  );
}

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
        <Panel
          title={`Trial${upcomingTrials.length === 1 ? "" : "s"} coming up`}
          rows={upcomingTrials.map((tr) => ({
            key: `${tr.id}-${tr.session_date}`,
            name: tr.full_name,
            date: formatSgDate(tr.session_date),
          }))}
          note="Trying one lesson — mark them like anyone else on the day."
        />
      )}

      {/* ── Make-ups coming up ───────────────────────────────────────────
          An enrolled child from another class of the same kind, guesting
          for one lesson. Separate from trials because the coach's job
          differs: a make-up child is not new to the business, and the
          ordinary statuses apply — there is nothing to sell. */}
      {upcomingMakeups.length > 0 && (
        <Panel
          title={`Make-up${upcomingMakeups.length === 1 ? "" : "s"} coming up`}
          rows={upcomingMakeups.map((mk) => ({
            key: `${mk.id}-${mk.session_date}`,
            name: mk.full_name,
            date: formatSgDate(mk.session_date),
          }))}
          note="Joining this one lesson as a make-up — mark them like anyone else on the day."
        />
      )}

      {/* ── Extra lessons coming up ──────────────────────────────────────
          A lesson on a day this class does not normally run, arranged by the
          business's admin. Shown here for the same reason trials are: it is
          the thing the coach does not already know, and their weekday-based
          expectation of this class will not produce it. */}
      {upcomingExtras.length > 0 && (
        <Panel
          title={`Extra lesson${upcomingExtras.length === 1 ? "" : "s"} coming up`}
          rows={upcomingExtras.map((ex) => ({
            key: ex.id,
            name: ex.reason,
            date: formatSgDate(ex.session_date),
          }))}
          note="Not this class's usual day — mark it as normal once it has taken place."
        />
      )}
    </>
  );
}
