// The Invoices / Packages / Credit Notes switcher.
// Moved VERBATIM from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { Tab } from "../types";
import type { useBilling } from "../domain/useBilling";

type Billing = ReturnType<typeof useBilling>;

export function Tabs(p: Pick<Billing, "activeTab" | "setActiveTab">) {
  const { activeTab, setActiveTab } = p;
  return (
    <>
      {/* Tabs */}
      <View className="flex-row mx-5 mb-4 bg-gray-100 rounded-xl p-1">
        {(["Invoices", "Packages", "Credit Notes"] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-lg items-center ${
              activeTab === tab ? "bg-white shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                activeTab === tab ? "text-gray-900" : "text-gray-500"
              }`}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}
