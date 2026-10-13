// Which business: a read-only line for one, a picker for several.
// Moved from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); DESIGN.md in UI restyle step 3.6 — the chosen business is the
// Selected fill, not a blue.
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Surface } from "@/components/ui/Surface";
import type { useAddChild } from "../domain/useAddChild";

type AddChild = ReturnType<typeof useAddChild>;

export function TenantPicker(p: Pick<AddChild, "tenants" | "tenantId" | "setTenantId">) {
  const { tenants, tenantId, setTenantId } = p;
  // Which business. Shown as a read-only line when there is only one, a
  // picker when the family deals with several — the expected case for a
  // parent with children under different coaches.
  if (!(tenants !== null && tenants.length > 0)) return null;
  return (
    <Surface className="mb-3">
      <Text className="text-body font-medium text-ink mb-1.5">
        Coach or school <Text className="text-ink-muted">*</Text>
      </Text>
      {tenants.length === 1 ? (
        <Text className="text-body text-ink">{tenants[0].display_name}</Text>
      ) : (
        <View className="gap-2">
          {tenants.map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => setTenantId(t.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: tenantId === t.id }}
              className={`min-h-11 justify-center px-3 rounded-control border ${
                tenantId === t.id ? "bg-selected border-border-strong" : "bg-surface border-border"
              }`}
            >
              <Text
                className={`text-body ${
                  tenantId === t.id ? "font-semibold text-ink" : "font-medium text-ink-secondary"
                }`}
              >
                {t.display_name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TouchableOpacity
        onPress={() => router.push("/(parent)/home/join-tenant")}
        className="mt-1 min-h-11 justify-center self-start"
      >
        <Text className="text-body font-semibold text-primary">
          + Add another coach or school
        </Text>
      </TouchableOpacity>
    </Surface>
  );
}
