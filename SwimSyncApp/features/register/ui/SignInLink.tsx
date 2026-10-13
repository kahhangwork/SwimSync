// Already have an account? Sign In.
// Moved VERBATIM from app/(auth)/register.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside). Restyled in UI restyle step 4.3: a 44px Lane Blue link (the
// height is the Text's padding, so the router line is untouched).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";

export function SignInLink() {
  return (
    <>
      <View className="flex-row justify-center items-center mt-4">
        <Text className="text-body text-ink-secondary">Already have an account? </Text>
        <TouchableOpacity onPress={() => router.replace("/(auth)/login")}>
          <Text className="py-3 text-body font-semibold text-primary">Sign In</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
