import { useEffect, useState } from "react";
import {
  getSession,
  onAuthStateChange,
  signOut,
  updatePassword,
} from "../dao/resetPassword.repo";

export function useResetPassword() {
  const [status, setStatus] = useState<"checking" | "valid" | "invalid">(
    "checking"
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // The recovery link lands here with the session token in the URL hash.
  // supabase-js (detectSessionInUrl, on by default in the browser) parses it and
  // fires PASSWORD_RECOVERY. Wait for that session; fail if the link is expired.
  useEffect(() => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (!settled) {
        settled = true;
        setStatus(ok ? "valid" : "invalid");
      }
    };

    // An expired/invalid link comes back with an error in the URL hash.
    // ⚠ STAYS FIRST, before any client call (BATCH_E_PLAN.md RISK 2).
    if (
      typeof window !== "undefined" &&
      /error=/.test(window.location.hash)
    ) {
      settle(false);
      return;
    }

    getSession().then(({ data }) => {
      if (data.session) settle(true);
    });
    const {
      data: { subscription },
    } = onAuthStateChange((_event, session) => {
      if (session) settle(true);
    });
    const timer = setTimeout(() => settle(false), 3000);

    // ⚠ Both halves of this cleanup are load-bearing (RISK 2).
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
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
      setError(updErr.message);
      return;
    }
    // Force a clean re-login with the new password.
    await signOut();
    setLoading(false);
    setDone(true);
  }

  return {
    status,
    password,
    setPassword,
    confirm,
    setConfirm,
    error,
    loading,
    done,
    handleReset,
  };
}
