// The logo and the Create Account heading.
// Moved VERBATIM from app/(auth)/register.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import Logo from "@/components/Logo";

export function Heading() {
  return (
    <>
      <View className="items-center mb-8">
        <Logo size="md" className="mb-3" />
        <Text className="text-2xl font-bold text-gray-900">Create Account</Text>
        <Text className="text-gray-500 mt-1 text-sm text-center">
          Register as a parent to manage your children's swim classes
        </Text>
      </View>
    </>
  );
}
