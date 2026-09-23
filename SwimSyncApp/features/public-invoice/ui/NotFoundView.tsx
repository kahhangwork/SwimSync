// Invoice not found — a bad link, or a failed load.
// Moved VERBATIM from app/invoice/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text, View } from "react-native";
import Logo from "@/components/Logo";

export function NotFoundView() {
  return (
    <>
      <View className="flex-1 bg-sky-50 items-center justify-center px-6">
        <Logo size="lg" className="mb-4" />
        <Text className="text-xl font-bold text-gray-900 mb-2">
          Invoice not found
        </Text>
        <Text className="text-gray-500 text-center leading-6">
          This link is not valid. Please check with your swim school for a new
          link.
        </Text>
      </View>
    </>
  );
}
