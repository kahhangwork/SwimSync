// Account Details.
// Moved VERBATIM from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import Card from "@/components/Card";
import { Row } from "./Row";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function AccountCard(p: Pick<Settings, "session">) {
  const { session } = p;
  return (
    <>
      {/* Account */}
      <Card className="mb-4">
        <Text className="text-base font-bold text-gray-900 mb-3">
          Account Details
        </Text>
        <View className="gap-2">
          <Row label="Name"  value={session?.fullName ?? "—"} icon="person-outline" />
          <Row label="Email" value={session?.email ?? "—"}    icon="mail-outline" />
        </View>
      </Card>
    </>
  );
}
