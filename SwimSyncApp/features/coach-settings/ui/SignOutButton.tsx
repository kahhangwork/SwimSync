// Sign Out (confirmed first).
// Moved from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); restyled in UI restyle step 2.7.
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function SignOutButton(p: Pick<Settings, "confirmLogout">) {
  const { confirmLogout } = p;
  return (
    <>
      {/* Logout */}
      {/* DESIGN.md's destructive button: secondary shape, Danger text, behind a
          confirmation (confirmLogout → confirmAction, never Alert.alert). Not
          the shared Button's destructive variant: that would add a SECOND
          confirm on top of confirmLogout's. The word is the pressable's direct
          child (pressByText dispatches on the leaf's parent). */}
      <TouchableOpacity
        onPress={confirmLogout}
        className="min-h-11 flex-row items-center justify-center gap-2 rounded-control border border-border-strong bg-surface"
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={18} color="#b91c1c" />
        <Text className="text-body font-semibold text-status-danger-text">Sign Out</Text>
      </TouchableOpacity>
    </>
  );
}
