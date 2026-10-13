// No business joined yet — send them to the join screen.
// Moved from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); DESIGN.md in UI restyle step 3.6.
import React from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Surface } from "@/components/ui/Surface";
import { Button } from "@/components/ui/Button";
import type { useAddChild } from "../domain/useAddChild";

type AddChild = ReturnType<typeof useAddChild>;

export function JoinFirstPrompt(p: Pick<AddChild, "tenants">) {
  const { tenants } = p;
  // No business joined yet: the form is useless until there is one, so
  // send them to the join screen rather than letting them fill it in and
  // fail on save.
  if (!(tenants !== null && tenants.length === 0)) return null;
  return (
    <Surface className="mb-3">
      <Text className="text-headline font-semibold text-ink">
        Join your coach first
      </Text>
      <Text className="mt-1 text-body text-ink-secondary">
        Your coach or swim school will give you a join code. You&rsquo;ll
        need it before you can add a child.
      </Text>
      <Button
        label="Enter a join code"
        onPress={() => router.push("/(parent)/home/join-tenant")}
        className="mt-4"
      />
    </Surface>
  );
}
