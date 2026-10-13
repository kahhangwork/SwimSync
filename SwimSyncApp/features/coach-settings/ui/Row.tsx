// One labelled row of the Account Details card.
// Moved from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H), where it was a module-level component below the screen.
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <View className="flex-row items-center gap-3 py-1.5">
      <Ionicons name={icon as any /* db-any-ok: icon */} size={16} color="#6b6b6b" />
      <Text className="text-body-secondary text-ink-secondary w-14">{label}</Text>
      <Text className="text-body font-medium text-ink flex-1">{value}</Text>
    </View>
  );
}
