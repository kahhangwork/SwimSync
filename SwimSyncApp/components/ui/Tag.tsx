// DESIGN.md's status tag (UI restyle step 1.3): the five-step status scale, always
// a WORD — colour is never the only signal. Which status gets which tone is step
// 1.4's map, not this file's: a Tag only knows tones.
//
// Full literal class strings per tone, never `bg-status-${tone}-bg` — Tailwind
// purges what it cannot read whole (§7.191). lib/uiPrimitives.drift.test.ts holds it.
import React from "react";
import { View, Text } from "react-native";

export type Tone = "neutral" | "info" | "warning" | "danger" | "success";

const BOX: Record<Tone, string> = {
  neutral: "self-start rounded-tag border px-1.5 py-0.5 bg-status-neutral-bg border-status-neutral-border",
  info: "self-start rounded-tag border px-1.5 py-0.5 bg-status-info-bg border-status-info-border",
  warning: "self-start rounded-tag border px-1.5 py-0.5 bg-status-warning-bg border-status-warning-border",
  danger: "self-start rounded-tag border px-1.5 py-0.5 bg-status-danger-bg border-status-danger-border",
  success: "self-start rounded-tag border px-1.5 py-0.5 bg-status-success-bg border-status-success-border",
};

const TEXT: Record<Tone, string> = {
  neutral: "text-label font-medium text-status-neutral-text",
  info: "text-label font-medium text-status-info-text",
  warning: "text-label font-medium text-status-warning-text",
  danger: "text-label font-medium text-status-danger-text",
  success: "text-label font-medium text-status-success-text",
};

export function Tag({ label, tone, className = "" }: { label: string; tone: Tone; className?: string }) {
  return (
    <View className={`${BOX[tone]} ${className}`}>
      <Text className={TEXT[tone]}>{label}</Text>
    </View>
  );
}
