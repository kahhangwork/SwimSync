// The full-screen spinner while the child loads.
// Moved VERBATIM from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { SafeAreaView, ActivityIndicator } from "react-native";

export function LoadingView() {
  return (
    <>
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    </>
  );
}
