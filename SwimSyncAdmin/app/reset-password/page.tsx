"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

export default function ResetPasswordPage() {
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
    if (
      typeof window !== "undefined" &&
      /error=/.test(window.location.hash)
    ) {
      settle(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) settle(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) settle(true);
    });
    const timer = setTimeout(() => settle(false), 3000);

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
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setLoading(false);
      setError(updErr.message);
      return;
    }
    // Force a clean re-login with the new password.
    await supabase.auth.signOut();
    setLoading(false);
    setDone(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sky-50 px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" className="mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">Set New Password</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">
            Choose a new password for your admin account
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-7">
          {status === "checking" ? (
            <p className="text-sm text-gray-500 text-center py-4">
              Verifying reset link…
            </p>
          ) : status === "invalid" ? (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                Link expired
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                This reset link is invalid or has expired. Please request a new
                one.
              </p>
              <Link
                href="/forgot-password"
                className="block w-full rounded-xl bg-sky-500 py-2.5 text-center text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
              >
                Request New Link
              </Link>
            </div>
          ) : done ? (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                Password updated
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                Your password has been reset. Please sign in with your new
                password.
              </p>
              <Link
                href="/login"
                className="block w-full rounded-xl bg-sky-500 py-2.5 text-center text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  New Password
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
                  Confirm New Password
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
                {loading ? "Updating…" : "Update Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
