// The Change Password screen's state and save (docs/refactor/BATCH_FGH_PLAN.md, app
// fence) — moved VERBATIM from components/ChangePasswordScreen.tsx; the auth call is
// a dao call. No verify-* driver submits it — L4-Fence hand-checks both roles.
import { useState } from "react";
import { friendlyAuthError } from "@/lib/authErrors";
import { updatePassword } from "../dao/changePassword.auth";

export function useChangePassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSave() {
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
    setLoading(false);

    if (updErr) {
      setError(friendlyAuthError(updErr));
      return;
    }
    setDone(true);
  }

  return {
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    error,
    done,
    handleSave,
  };
}
