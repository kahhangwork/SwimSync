// The back chevron and title.
// Moved from app/(parent)/billing/paynow.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); DESIGN.md in UI restyle step 3.3.
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export function Header() {
  return (
    <View className="flex-row items-center gap-2 px-3 pt-4 pb-3">
      <TouchableOpacity
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        className="w-11 h-11 items-center justify-center"
      >
        <Ionicons name="chevron-back" size={24} color="#2563eb" />
      </TouchableOpacity>
      <Text className="text-headline font-semibold text-ink">PayNow Payment</Text>
    </View>
  );
}
