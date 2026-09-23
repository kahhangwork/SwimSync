// The two quick-action buttons.
// Moved VERBATIM from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";

export function QuickActions() {
  return (
    <>
      {/* Quick actions */}
      <View className="gap-3">
        <PrimaryButton
          label="View Attendance History"
          onPress={() => router.push("/(parent)/attendance")}
        />
        <PrimaryButton
          label="View Invoices"
          variant="outline"
          onPress={() => router.push("/(parent)/billing")}
        />
      </View>
    </>
  );
}
