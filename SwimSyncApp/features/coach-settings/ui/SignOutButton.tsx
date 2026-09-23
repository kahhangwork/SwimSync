// Sign Out (confirmed first).
// Moved VERBATIM from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function SignOutButton(p: Pick<Settings, "confirmLogout">) {
  const { confirmLogout } = p;
  return (
    <>
      {/* Logout */}
      <TouchableOpacity
        onPress={confirmLogout}
        className="bg-red-50 border border-red-100 rounded-2xl py-4 items-center"
        activeOpacity={0.8}
      >
        <View className="flex-row items-center gap-2">
          <Ionicons name="log-out-outline" size={20} color="#dc2626" />
          <Text className="text-red-600 font-semibold">Sign Out</Text>
        </View>
      </TouchableOpacity>
    </>
  );
}
