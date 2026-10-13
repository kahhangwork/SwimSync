// The "lessons used" list under an active package (Wave 6 D3). Dated lines,
// legacy invoice-time ones included; a returned lesson is labelled, not hidden.
// DESIGN.md in UI restyle step 3.8: Lane Blue toggle, Ink lines, nothing under 12px.
import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usageLines, usageToggleLabel } from "../domain/packageUsage";
import type { PackageUsage } from "../domain/usePackageUsage";

export function PackageUsageList({ packageId, usage }: { packageId: string; usage: PackageUsage }) {
  const s = usage.stateOf(packageId);
  return (
    <View className="pt-1 mt-2 border-t border-divider">
      <TouchableOpacity
        onPress={() => usage.toggle(packageId)}
        className="min-h-11 flex-row items-center justify-between"
        accessibilityRole="button"
        accessibilityState={{ expanded: s.open }}
      >
        <Text className="text-body-secondary font-semibold text-primary">{usageToggleLabel(s.open, s.rows)}</Text>
        <Ionicons name={s.open ? "chevron-up" : "chevron-down"} size={14} color="#2563eb" />
      </TouchableOpacity>

      {s.open && (
        <View className="mt-1">
          {s.loading && <ActivityIndicator size="small" />}
          {s.error && <Text className="text-body-secondary text-status-danger-text">{s.error}</Text>}
          {s.rows && s.rows.length === 0 && (
            <Text className="text-body-secondary text-ink-secondary">No lessons have used this package yet.</Text>
          )}
          {s.rows &&
            usageLines(s.rows).map((l) => (
              <View key={l.key} className="flex-row justify-between py-1">
                <View className="flex-1 pr-2">
                  <Text className={`text-body-secondary ${l.returned ? "text-ink-muted line-through" : "text-ink"}`}>
                    {l.date} · {l.who}
                  </Text>
                  {l.returned && (
                    <Text className="text-label text-ink-secondary">Returned to the package</Text>
                  )}
                  {l.note && <Text className="text-label text-ink-muted">{l.note}</Text>}
                </View>
                <Text
                  className={`text-body-secondary ${l.returned ? "text-ink-muted line-through" : "text-ink"}`}
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {l.amount}
                </Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}
