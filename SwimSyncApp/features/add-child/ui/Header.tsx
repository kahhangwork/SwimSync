// The back chevron and title.
// Moved VERBATIM from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export function Header() {
  return (
    <>
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">Add Child</Text>
      </View>
    </>
  );
}
