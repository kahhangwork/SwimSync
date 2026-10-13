// The menu: Change Password.
// Moved from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); restyled in UI restyle step 2.7.
import React from "react";
import { router } from "expo-router";
import { Surface } from "@/components/ui/Surface";
import { MenuItem } from "./MenuItem";

export function MenuCard() {
  return (
    <>
      {/* Menu */}
      <Surface className="mb-4 py-1">
        <MenuItem
          icon="lock-closed-outline"
          label="Change Password"
          onPress={() => router.push("/(coach)/settings/change-password")}
          last
        />
      </Surface>
    </>
  );
}
