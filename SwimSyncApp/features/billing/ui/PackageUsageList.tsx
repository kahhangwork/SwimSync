// The "lessons used" list under an active package (Wave 6 D3). Dated lines,
// legacy invoice-time ones included; a returned lesson is labelled, not hidden.
import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usageLines, usageToggleLabel } from "../domain/packageUsage";
import type { PackageUsage } from "../domain/usePackageUsage";

export function PackageUsageList({ packageId, usage }: { packageId: string; usage: PackageUsage }) {
  const s = usage.stateOf(packageId);
  return (
    <View className="pt-2 mt-2 border-t border-gray-100">
      <TouchableOpacity
        onPress={() => usage.toggle(packageId)}
        className="flex-row items-center justify-between py-1"
        accessibilityRole="button"
        accessibilityState={{ expanded: s.open }}
      >
        <Text className="text-xs font-semibold text-sky-600">{usageToggleLabel(s.open, s.rows)}</Text>
        <Ionicons name={s.open ? "chevron-up" : "chevron-down"} size={14} color="#0284c7" />
      </TouchableOpacity>

      {s.open && (
        <View className="mt-1">
          {s.loading && <ActivityIndicator size="small" />}
          {s.error && <Text className="text-xs text-red-600">{s.error}</Text>}
          {s.rows && s.rows.length === 0 && (
            <Text className="text-xs text-gray-400">No lessons have used this package yet.</Text>
          )}
          {s.rows &&
            usageLines(s.rows).map((l) => (
              <View key={l.key} className="flex-row justify-between py-1">
                <View className="flex-1 pr-2">
                  <Text className={`text-xs ${l.returned ? "text-gray-400 line-through" : "text-gray-700"}`}>
                    {l.date} · {l.who}
                  </Text>
                  {l.returned && (
                    <Text className="text-[11px] text-emerald-600">Returned to the package</Text>
                  )}
                  {l.note && <Text className="text-[11px] text-gray-400">{l.note}</Text>}
                </View>
                <Text className={`text-xs ${l.returned ? "text-gray-400 line-through" : "text-gray-700"}`}>
                  {l.amount}
                </Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}
