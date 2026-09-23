// The menu: Change Password.
// Moved VERBATIM from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { router } from "expo-router";
import Card from "@/components/Card";
import { MenuItem } from "./MenuItem";

export function MenuCard() {
  return (
    <>
      {/* Menu */}
      <Card className="mb-4">
        <MenuItem
          icon="lock-closed-outline"
          label="Change Password"
          onPress={() => router.push("/(coach)/settings/change-password")}
          last
        />
      </Card>
    </>
  );
}
