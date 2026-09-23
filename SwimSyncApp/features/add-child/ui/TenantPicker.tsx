// Which business: a read-only line for one, a picker for several.
// Moved VERBATIM from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import type { useAddChild } from "../domain/useAddChild";

type AddChild = ReturnType<typeof useAddChild>;

export function TenantPicker(p: Pick<AddChild, "tenants" | "tenantId" | "setTenantId">) {
  const { tenants, tenantId, setTenantId } = p;
  return (
    <>
      {/* Which business. Shown as a read-only line when there is only one, a
          picker when the family deals with several — the expected case for a
          parent with children under different coaches. */}
      {tenants !== null && tenants.length > 0 && (
        <View className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
          <Text className="text-sm font-medium text-gray-700 mb-1.5">
            Coach or school <Text className="text-red-500">*</Text>
          </Text>
          {tenants.length === 1 ? (
            <Text className="text-gray-900">{tenants[0].display_name}</Text>
          ) : (
            <View className="gap-2">
              {tenants.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setTenantId(t.id)}
                  className={`py-3 px-4 rounded-xl border ${
                    tenantId === t.id
                      ? "bg-sky-500 border-sky-500"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <Text
                    className={`font-medium text-sm ${
                      tenantId === t.id ? "text-white" : "text-gray-700"
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
            className="mt-3"
          >
            <Text className="text-sm font-medium text-sky-600">
              + Add another coach or school
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );
}
