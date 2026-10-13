// Account Details.
// Moved from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); restyled in UI restyle step 2.7.
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import { Row } from "./Row";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function AccountCard(p: Pick<Settings, "session">) {
  const { session } = p;
  return (
    <>
      {/* Account */}
      <Surface className="mb-4">
        <Text className="text-headline font-semibold text-ink mb-2">
          Account Details
        </Text>
        <View className="gap-2">
          <Row label="Name"  value={session?.fullName ?? "—"} icon="person-outline" />
          <Row label="Email" value={session?.email ?? "—"}    icon="mail-outline" />
        </View>
      </Surface>
    </>
  );
}
