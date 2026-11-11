// The "different package?" line and the SwimSync footer.
// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). Restyled in UI restyle step 4.6.
//
// "Prefer a different package?" was a dead end ("Tell your coach." — the payload
// carries no business contact). It now links to Billing → Packages, where a parent
// can request any package (user, 2026-11-11: no business contact field, nothing
// personal on a public page). Signed in, the link lands there. Signed OUT it goes to
// Sign In instead — nothing redirects an in-app push to /billing without a session
// (the root layout routes on launch and on auth events only), so the copy names
// where to go once signed in.
import React from "react";
import { Text } from "react-native";
import { Link } from "expo-router";
import { useAppStore } from "@/store/useAppStore";

export function Footer() {
  const signedIn = useAppStore((st) => st.session) !== null;
  return (
    <>
      <Text className="text-center text-body-secondary text-ink-secondary">
        Prefer a different package?
      </Text>
      <Link
        href={signedIn ? "/(parent)/billing?tab=packages" : "/(auth)/login"}
        className="self-center py-3 text-body font-semibold text-primary text-center"
      >
        Sign in to choose another in Billing → Packages
      </Link>
      <Text className="text-center text-label text-ink-muted mt-2">
        SwimSync · Swim attendance & billing
      </Text>
    </>
  );
}
