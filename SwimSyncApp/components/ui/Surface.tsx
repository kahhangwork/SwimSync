// DESIGN.md's card (UI restyle step 1.3): Surface, 1px Border, 8px corners, 16px
// padding, no shadow. Beside the legacy components/Card until Phase 7.
import React from "react";
import { View, type ViewProps } from "react-native";

/** The card's classes, for a pressable that must BE the card (not wrap one). */
export const SURFACE = "bg-surface border border-border rounded-card p-4";

export function Surface({ className = "", children, ...rest }: ViewProps & { className?: string }) {
  return (
    <View className={`${SURFACE} ${className}`} {...rest}>
      {children}
    </View>
  );
}
