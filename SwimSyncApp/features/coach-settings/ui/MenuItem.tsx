// One tappable menu row.
// Moved from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H), where it was a module-level component below the screen.
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function MenuItem({
  icon,
  label,
  onPress,
  last = false,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className={
        last
          ? "min-h-11 flex-row items-center gap-3 py-3"
          : "min-h-11 flex-row items-center gap-3 py-3 border-b border-divider"
      }
    >
      <Ionicons name={icon as any /* db-any-ok: icon */} size={20} color="#525252" />
      <Text className="flex-1 text-body text-ink">{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#6b6b6b" />
    </TouchableOpacity>
  );
}
