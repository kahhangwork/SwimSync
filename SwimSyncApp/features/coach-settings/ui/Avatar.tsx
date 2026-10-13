// The coach's initial, name and email.
// Moved from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); restyled in UI restyle step 2.7.
import React from "react";
import { View, Text } from "react-native";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

/** "Coach Marcus", never "Coach Coach Marcus" when the stored name already carries
 *  the title — the same rule as the Schedule greeting's coachTitle()
 *  (features/schedule/domain/scheduleFormat.ts), kept local: one feature does not
 *  import another's domain. */
function coachTitle(fullName: string | null | undefined): string {
  const name = (fullName ?? "").trim();
  if (!name) return "Coach —";
  return /^coach\b/i.test(name) ? name : `Coach ${name}`;
}

export function Avatar(p: Pick<Settings, "session">) {
  const { session } = p;
  return (
    <>
      {/* Avatar */}
      {/* The screen title: who is signed in. No initial-in-a-circle — DESIGN.md
          has no avatars, and the name says it. */}
      <View className="mb-5">
        <Text className="text-display font-semibold text-ink">
          {coachTitle(session?.fullName)}
        </Text>
        <Text className="text-body-secondary text-ink-secondary">{session?.email ?? "—"}</Text>
      </View>
    </>
  );
}
