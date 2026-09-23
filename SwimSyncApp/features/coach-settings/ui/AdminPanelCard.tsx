// Open admin panel — shown only to the business's admin.
// Moved VERBATIM from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text } from "react-native";
import Card from "@/components/Card";
import { MenuItem } from "./MenuItem";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function AdminPanelCard(p: Pick<Settings, "canEditQr" | "openAdminPanel">) {
  const { canEditQr, openAdminPanel } = p;
  return (
    <>
      {/* The admin panel. Gated on the SAME predicate that decides whether
          this coach may edit the QR (profile.role === 'tenant_admin'), which
          is also what the panel's own door checks (§7.91) — so a plain coach
          must not see this at all. Absence is the point: a disabled-looking
          link still tells them the panel exists. Do NOT loosen the panel's
          entry gate if this is ever reported as "broken"; that gate is
          deliberate. */}
      {canEditQr && (
        <Card className="mb-4">
          <MenuItem
            icon="desktop-outline"
            label="Open admin panel"
            onPress={openAdminPanel}
            last
          />
          <Text className="text-xs text-gray-500 mt-2">
            Classes, students, invoices and your PayNow ID are managed at
            admin.swimsync.sg.
          </Text>
        </Card>
      )}
    </>
  );
}
