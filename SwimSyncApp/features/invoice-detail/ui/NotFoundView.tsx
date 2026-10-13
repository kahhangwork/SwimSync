// The invoice could not be loaded.
// Moved from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); DESIGN.md in UI restyle step 3.2.
import React from "react";
import { Text, SafeAreaView } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";

export function NotFoundView() {
  return (
    <SafeAreaView className="flex-1 bg-ground items-center justify-center px-6">
      <Ionicons name="alert-circle-outline" size={40} color="#6b6b6b" />
      <Text className="text-body text-ink-secondary mt-3 text-center">
        Could not load invoice.
      </Text>
      <Button variant="link" label="Go Back" onPress={() => router.back()} className="mt-2" />
    </SafeAreaView>
  );
}
