// Already have an account? Sign In.
// Moved VERBATIM from app/(auth)/register.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";

export function SignInLink() {
  return (
    <>
      <View className="flex-row justify-center mt-6">
        <Text className="text-gray-500">Already have an account? </Text>
        <TouchableOpacity onPress={() => router.replace("/(auth)/login")}>
          <Text className="text-sky-500 font-semibold">Sign In</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
