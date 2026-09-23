// No business joined yet — send them to the join screen.
// Moved VERBATIM from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import type { useAddChild } from "../domain/useAddChild";

type AddChild = ReturnType<typeof useAddChild>;

export function JoinFirstPrompt(p: Pick<AddChild, "tenants">) {
  const { tenants } = p;
  return (
    <>
      {/* No business joined yet: the form is useless until there is one, so
          send them to the join screen rather than letting them fill it in and
          fail on save. */}
      {tenants !== null && tenants.length === 0 && (
        <View className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
          <Text className="text-base font-semibold text-gray-900">
            Join your coach first
          </Text>
          <Text className="mt-1 text-sm text-gray-600">
            Your coach or swim school will give you a join code. You&rsquo;ll
            need it before you can add a child.
          </Text>
          <PrimaryButton
            label="Enter a join code"
            onPress={() => router.push("/(parent)/home/join-tenant")}
            className="mt-4"
          />
        </View>
      )}
    </>
  );
}
