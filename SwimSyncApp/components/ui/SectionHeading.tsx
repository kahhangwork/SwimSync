// DESIGN.md's section label (UI restyle step 1.3): the small muted heading over a
// group of cards — "Coming up", "Done". The screen title is Display, a card title
// Headline; this is neither. (The legacy SectionHeader went in 7.1.)
import React from "react";
import { Text } from "react-native";

export const SECTION_HEADING = "text-label font-semibold text-ink-muted";

export function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <Text accessibilityRole="header" className={`${SECTION_HEADING} ${className}`}>
      {children}
    </Text>
  );
}
