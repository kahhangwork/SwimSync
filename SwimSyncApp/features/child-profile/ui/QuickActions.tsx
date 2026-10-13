// The two quick-action buttons.
// Moved from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); DESIGN.md in UI restyle step 3.5 — both secondary: neither is the
// thing this screen exists for, so neither takes the one Lane Blue primary.
import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/ui/Button";

export function QuickActions() {
  return (
    <View className="gap-3">
      <Button
        variant="secondary"
        label="View Attendance History"
        onPress={() => router.push("/(parent)/attendance")}
      />
      <Button
        variant="secondary"
        label="View Invoices"
        onPress={() => router.push("/(parent)/billing")}
      />
    </View>
  );
}
