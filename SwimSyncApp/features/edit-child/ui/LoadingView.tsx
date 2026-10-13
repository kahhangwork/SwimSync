// The full-screen spinner until the child's fields are loaded.
// Moved from app/(parent)/home/edit-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); DESIGN.md in UI restyle step 3.6.
import React from "react";
import { SafeAreaView, ActivityIndicator } from "react-native";

export function LoadingView() {
  return (
    <SafeAreaView className="flex-1 bg-ground items-center justify-center">
      <ActivityIndicator size="large" color="#2563eb" />
    </SafeAreaView>
  );
}
