// The invoice could not be loaded.
// Moved VERBATIM from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text, TouchableOpacity, SafeAreaView } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export function NotFoundView() {
  return (
    <>
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center px-6">
        <Ionicons name="alert-circle-outline" size={40} color="#d1d5db" />
        <Text className="text-gray-400 mt-3 text-center">
          Could not load invoice.
        </Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="text-sky-500 font-semibold">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </>
  );
}
