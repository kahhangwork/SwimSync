// The Invoices / Packages / Credit Notes switcher.
// Moved from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-G).
// UI restyle step 3.1: a segmented control — the chosen segment is the Selected
// fill with Ink 600 text (DESIGN.md), never a shadow; each segment is 44px.
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { Tab } from "../types";
import type { useBilling } from "../domain/useBilling";

type Billing = ReturnType<typeof useBilling>;

export function Tabs(p: Pick<Billing, "activeTab" | "setActiveTab">) {
  const { activeTab, setActiveTab } = p;
  return (
    <View className="flex-row mx-5 mb-4 bg-surface border border-border rounded-card p-1 gap-1">
      {(["Invoices", "Packages", "Credit Notes"] as Tab[]).map((tab) => {
        const active = activeTab === tab;
        return (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            aria-pressed={active}
            className={`flex-1 min-h-11 rounded-control items-center justify-center ${
              active ? "bg-selected" : "bg-surface"
            }`}
          >
            <Text
              className={`text-body ${
                active ? "font-semibold text-ink" : "font-medium text-ink-secondary"
              }`}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
