// The greeting and the parent's initial.
// Moved VERBATIM from app/(parent)/home/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import type { useParentHome } from "../domain/useParentHome";

type Home = ReturnType<typeof useParentHome>;

export function Greeting(p: Pick<Home, "session">) {
  const { session } = p;
  return (
    <>
      {/* Greeting */}
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-gray-500 text-sm">Welcome back,</Text>
          <Text className="text-2xl font-bold text-gray-900">
            {session?.fullName ?? "—"}
          </Text>
        </View>
        <View className="w-10 h-10 rounded-full bg-sky-500 items-center justify-center">
          <Text className="text-white font-bold text-base">
            {session?.fullName?.charAt(0) ?? "?"}
          </Text>
        </View>
      </View>
    </>
  );
}
