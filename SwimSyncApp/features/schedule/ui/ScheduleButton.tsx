// The Schedule tab's buttons and card surface, in DESIGN.md's tokens.
// Local to this screen on purpose: components/PrimaryButton and components/Card
// are shared by every screen, and DESIGN.md migrates ONE screen at a time
// (BACKLOG → UI/UX improvements). When the last screen has moved, these fold back
// into the shared components.
import React from "react";
import { TouchableOpacity, Text, type TouchableOpacityProps } from "react-native";

/** A flat bordered card: Surface, 1px Border, 8px corners, no shadow. */
export const CARD = "bg-surface border border-border rounded-card p-4";

/** Primary = the one Lane Blue action; secondary = outlined, everything else. */
export function ScheduleButton({
  label,
  variant = "primary",
  className = "",
  ...rest
}: TouchableOpacityProps & { label: string; variant?: "primary" | "secondary" }) {
  const box =
    variant === "primary"
      ? "bg-primary"
      : "bg-surface border border-border-strong";
  const text = variant === "primary" ? "text-white" : "text-ink";
  return (
    <TouchableOpacity
      className={`min-h-11 px-4 rounded-control items-center justify-center ${box} ${className}`}
      activeOpacity={0.8}
      accessibilityRole="button"
      {...rest}
    >
      <Text className={`text-body font-semibold ${text}`}>{label}</Text>
    </TouchableOpacity>
  );
}
