// Invoice not found — a bad link, or a failed load.
// Moved VERBATIM from app/invoice/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
//
// UI restyle step 4.5: it was a dead end (BACKLOG *UI/UX improvements*, fold-in) — it
// now offers a way forward, Sign in, which a parent with an account can always
// use. A link the parent chooses, not a redirect (plan Phase 4: no redirect is
// touched); a signed-in parent is sent on to their landing by the root layout
// exactly as /login always does. A standalone Lane Blue link, 44px tall.
import React from "react";
import { Text, View } from "react-native";
import { Link } from "expo-router";
import Logo from "@/components/Logo";

export function NotFoundView() {
  return (
    <>
      <View className="flex-1 bg-ground items-center justify-center px-5">
        <Logo size="lg" className="mb-4" />
        <Text className="text-display font-semibold text-ink mb-2">
          Invoice not found
        </Text>
        <Text className="text-body text-ink-secondary text-center max-w-sm">
          This link is not valid. Please check with your swim school for a new
          link.
        </Text>
        <Link
          href="/(auth)/login"
          replace
          className="mt-4 py-3 text-body font-semibold text-primary"
        >
          Sign in to SwimSync
        </Link>
      </View>
    </>
  );
}
