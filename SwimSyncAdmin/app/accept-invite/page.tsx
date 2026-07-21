"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

/**
 * Where an invited business owner lands to set their FIRST password.
 *
 * Deliberately separate from /reset-password even though the mechanics are
 * nearly identical. That page's copy is all wrong here — it says "reset", which
 * implies a password they never had, and its failure state points at
 * /forgot-password, which an invitee cannot use: there is no account to recover
 * until they have set one. This is a business owner's very first contact with
 * SwimSync, and it names the business they are being handed.
 */
export default function AcceptInvitePage() {
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

    if (typeof window !== "undefined" && /error=/.test(window.location.hash)) {
      settle(false);
      return;
    }

    // Name the business they're being given, so the page proves it is about
    // them and not a generic password form.
    const loadBusiness = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("tenants(display_name)")
        .maybeSingle();
      const t = Array.isArray(data?.tenants) ? data?.tenants[0] : data?.tenants;
      if (t?.display_name) setBusiness(t.display_name);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settle(true);
        loadBusiness();
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        settle(true);
        loadBusiness();
      }
    });
    const timer = setTimeout(() => settle(false), 3000);

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
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setLoading(false);
      setError(updErr.message);
      return;
    }
    // Force a clean sign-in with the new password, same as /reset-password.
    await supabase.auth.signOut();
    setLoading(false);
    setDone(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sky-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" className="mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome to SwimSync
          </h1>
          <p className="text-sm text-gray-500 mt-1 text-center">
            {business
              ? `Choose a password to start running ${business}`
              : "Choose a password to get started"}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-7">
          {status === "checking" ? (
            <p className="text-sm text-gray-500 text-center py-4">
              Checking your invite…
            </p>
          ) : status === "invalid" ? (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                This invite has expired
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                Invite links can only be used once. Ask your SwimSync contact to
                send you a new one — you don&apos;t need to do anything else.
              </p>
              <Link
                href="/login"
                className="block w-full rounded-xl bg-sky-500 py-2.5 text-center text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
              >
                Back to Sign In
              </Link>
            </div>
          ) : done ? (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                You&apos;re all set
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                Your password has been saved. Sign in to set up your classes and
                start adding students.
              </p>
              <Link
                href="/login"
                className="block w-full rounded-xl bg-sky-500 py-2.5 text-center text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
              >
                Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Choose a Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Confirm Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="block w-full rounded-xl bg-sky-500 py-2.5 text-center text-sm font-semibold text-white hover:bg-sky-600 transition-colors disabled:opacity-60"
              >
                {loading ? "Saving…" : "Set Password & Continue"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
