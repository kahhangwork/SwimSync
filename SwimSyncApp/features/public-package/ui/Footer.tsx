// The "different package?" line and the SwimSync footer.
// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside). Restyled in UI restyle step 4.6. "Tell your coach" stays
// plain text: the public-package payload carries no contact for the business,
// and a restyle adds no query (BACKLOG *UI restyle leftovers* keeps it).
import React from "react";
import { Text } from "react-native";

export function Footer() {
  return (
    <>
      <Text className="text-center text-body-secondary text-ink-secondary mb-2">
        Prefer a different package? Tell your coach.
      </Text>
      <Text className="text-center text-label text-ink-muted">
        SwimSync · Swim attendance & billing
      </Text>
    </>
  );
}
