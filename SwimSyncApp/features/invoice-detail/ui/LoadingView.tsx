// The full-screen spinner while the invoice loads.
// Moved from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); DESIGN.md in UI restyle step 3.2.
import React from "react";
import { SafeAreaView, ActivityIndicator } from "react-native";

export function LoadingView() {
  return (
    <SafeAreaView className="flex-1 bg-ground items-center justify-center">
      <ActivityIndicator size="large" color="#2563eb" />
    </SafeAreaView>
  );
}
