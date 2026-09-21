import { useEffect, useState } from "react";
import {
  getSession,
  loadBusinessName,
  onAuthStateChange,
  signOut,
  updatePassword,
} from "../dao/acceptInvite.repo";

export function useAcceptInvite() {
  const [status, setStatus] = useState<"checking" | "valid" | "invalid">(
    "checking"
  );
  const [business, setBusiness] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // The invite link lands here with the session token in the URL hash;
  // supabase-js (detectSessionInUrl) parses it. Same settling logic as
  // /reset-password: wait for a session, fail on an error hash or a timeout.
  useEffect(() => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (!settled) {
        settled = true;
        setStatus(ok ? "valid" : "invalid");
      }
    };

    // ⚠ STAYS FIRST, before any client call (BATCH_E_PLAN.md RISK 2): an
    // expired link must settle invalid without opening a session.
    if (typeof window !== "undefined" && /error=/.test(window.location.hash)) {
      settle(false);
      return;
    }

    // Name the business they're being given, so the page proves it is about
    // them and not a generic password form.
    const loadBusiness = async () => {
      const { data } = await loadBusinessName();
      const t = Array.isArray(data?.tenants) ? data?.tenants[0] : data?.tenants;
      if (t?.display_name) setBusiness(t.display_name);
    };

    getSession().then(({ data }) => {
      if (data.session) {
        settle(true);
        loadBusiness();
      }
    });
    const {
      data: { subscription },
    } = onAuthStateChange((_event, session) => {
      if (session) {
        settle(true);
        loadBusiness();
      }
    });
    const timer = setTimeout(() => settle(false), 3000);

    // ⚠ Both halves of this cleanup are load-bearing (RISK 2).
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password || !confirm) {
      setError("Please enter and confirm your password.");
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
    // Force a clean sign-in with the new password, same as /reset-password.
    await signOut();
    setLoading(false);
    setDone(true);
  }

  return {
    status,
    business,
    password,
    setPassword,
    confirm,
    setConfirm,
    error,
    loading,
    done,
    handleSubmit,
  };
}
