// The logo and the Create Account heading.
// Moved VERBATIM from app/(auth)/register.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside). Restyled in UI restyle step 4.3 (Display title, Ink
// Secondary line). "Create Account" is also the button's word — the drivers
// press .last(), so the heading stays first.
import React from "react";
import { View, Text } from "react-native";
import Logo from "@/components/Logo";

export function Heading() {
  return (
    <>
      <View className="items-center mb-8">
        <Logo size="md" className="mb-3" />
        <Text className="text-display font-semibold text-ink">Create Account</Text>
        <Text className="text-body text-ink-secondary mt-1 text-center">
          Register as a parent to manage your children's swim classes
        </Text>
      </View>
    </>
  );
}
