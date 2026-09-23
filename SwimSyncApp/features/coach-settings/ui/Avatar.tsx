// The coach's initial, name and email.
// Moved VERBATIM from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function Avatar(p: Pick<Settings, "session">) {
  const { session } = p;
  return (
    <>
      {/* Avatar */}
      <View className="items-center mb-8">
        <View className="w-20 h-20 rounded-full bg-sky-500 items-center justify-center mb-3">
          <Text className="text-white text-3xl font-bold">
            {session?.fullName?.charAt(0) ?? "?"}
          </Text>
        </View>
        <Text className="text-xl font-bold text-gray-900">
          Coach {session?.fullName ?? "—"}
        </Text>
        <Text className="text-sm text-gray-500">{session?.email ?? "—"}</Text>
      </View>
    </>
  );
}
