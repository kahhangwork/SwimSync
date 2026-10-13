// The greeting.
// Moved from app/(parent)/home/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-F).
// UI restyle step 3.4: Display name, no initial circle (DESIGN.md: no fully
// rounded shapes but status dots).
import React from "react";
import { View, Text } from "react-native";
import type { useParentHome } from "../domain/useParentHome";

type Home = ReturnType<typeof useParentHome>;

export function Greeting(p: Pick<Home, "session">) {
  const { session } = p;
  return (
    <View className="mb-5">
      <Text className="text-body-secondary text-ink-secondary">Welcome back,</Text>
      <Text className="text-display font-semibold text-ink">
        {session?.fullName ?? "—"}
      </Text>
    </View>
  );
}
