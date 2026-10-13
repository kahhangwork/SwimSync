// Open admin panel — shown only to the business's admin.
// Moved from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); restyled in UI restyle step 2.7.
import React from "react";
import { Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import { MenuItem } from "./MenuItem";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function AdminPanelCard(p: Pick<Settings, "isAdmin" | "openAdminPanel">) {
  const { isAdmin, openAdminPanel } = p;
  return (
    <>
      {/* The admin panel. Gated on profile.role === 'tenant_admin', which is
          what the panel's own door checks (§7.91) — so a plain coach
          must not see this at all. Absence is the point: a disabled-looking
          link still tells them the panel exists. Do NOT loosen the panel's
          entry gate if this is ever reported as "broken"; that gate is
          deliberate. */}
      {isAdmin && (
        <Surface className="mb-4">
          <MenuItem
            icon="desktop-outline"
            label="Open admin panel"
            onPress={openAdminPanel}
            last
          />
          <Text className="text-body-secondary text-ink-secondary mt-2">
            Classes, students, invoices and your PayNow ID are managed at
            admin.swimsync.sg.
          </Text>
        </Surface>
      )}
    </>
  );
}
