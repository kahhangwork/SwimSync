// The back chevron, title and status badge.
// Moved VERBATIM from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";

export function Header(p: { statusLabel: string }) {
  const { statusLabel } = p;
  return (
    <>
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900 flex-1">Invoice Detail</Text>
        <StatusBadge status={statusLabel} size="sm" />
      </View>
    </>
  );
}
