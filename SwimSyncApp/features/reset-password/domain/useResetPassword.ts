// The Reset Password screen's state, the recovery-session check and the reset
// (docs/refactor/BATCH_FGH_PLAN.md, app fence). Moved VERBATIM from
// app/(auth)/reset-password.tsx; the three auth calls are dao calls. The mount
// effect ([] deps) is unchanged.
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { friendlyAuthError } from "@/lib/authErrors";
import { useAppStore } from "@/store/useAppStore";
import { getSession, updatePassword, signOut } from "../dao/resetPassword.auth";

export function useResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const showToast = useAppStore((s) => s.showToast);

  // This screen is only valid inside a recovery session (opened via the email
  // link). If there's no session, the link is invalid or expired.
  useEffect(() => {
    getSession().then(({ data: { session } }) => {
      if (!session) {
        showToast(
          "This reset link is invalid or has expired. Please request a new one.",
          "error"
        );
        router.replace("/(auth)/forgot-password");
        return;
      }
      setChecking(false);
    });
  }, []);

  async function handleReset() {
    setError(null);
    if (!password || !confirm) {
      setError("Please enter and confirm your new password.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    const { error: updErr } = await updatePassword(password);

    if (updErr) {
      setLoading(false);
      setError(friendlyAuthError(updErr));
      return;
    }

    // Force a clean re-login with the new password.
    await signOut();
    setLoading(false);

    showToast(
      "Password updated. Please sign in with your new password.",
      "success"
    );
    router.replace("/(auth)/login");
  }

  return {
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    checking,
    error,
    handleReset,
  };
}
