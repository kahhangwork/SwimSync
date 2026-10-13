// The full-screen spinner while the child loads.
// Moved from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); DESIGN.md in UI restyle step 3.5.
import React from "react";
import { SafeAreaView, ActivityIndicator } from "react-native";

export function LoadingView() {
  return (
    <SafeAreaView className="flex-1 bg-ground items-center justify-center">
      <ActivityIndicator size="large" color="#2563eb" />
    </SafeAreaView>
  );
}
