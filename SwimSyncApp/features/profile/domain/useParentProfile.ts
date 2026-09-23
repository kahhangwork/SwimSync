// The parent Profile tab's session read and Sign Out (docs/refactor/BATCH_FGH_PLAN.md,
// app fence). Moved VERBATIM from app/(parent)/profile/index.tsx; the sign-out is a
// dao call. No verify-* driver presses Sign Out — L4-Fence hand-checks it (plan ⚠ R5).
import { router } from "expo-router";
import { useAppStore } from "@/store/useAppStore";
import { confirmAction } from "@/lib/confirm";
import { signOut } from "../dao/profile.auth";

export function useParentProfile() {
  const session = useAppStore((s) => s.session);
  const clearSession = useAppStore((s) => s.clearSession);

  async function handleLogout() {
    await signOut();
    clearSession();
    router.replace("/(auth)/login");
  }

  function confirmLogout() {
    confirmAction(
      "Sign Out",
      "Are you sure you want to sign out?",
      handleLogout,
      "Sign Out"
    );
  }

  return {
    session,
    confirmLogout,
  };
}
