"use client";

// UI restyle step 4.7 (DESIGN.md): Ground, a flat 8px card, 36px inputs (Border
// Strong, Lane Blue focus), the shared Button, the error in Danger text. Words,
// the submit button and what it does are unchanged.
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { useResetPassword } from "./domain/useResetPassword";

export default function ResetPasswordPage() {
  const {
    status,
    password,
    setPassword,
    confirm,
    setConfirm,
    error,
    loading,
    done,
    handleReset,
  } = useResetPassword();

  return (
    <div className="min-h-screen flex items-center justify-center bg-ground px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" className="mb-3" />
          <h1 className="text-display font-semibold text-ink">Set New Password</h1>
          <p className="text-body text-ink-secondary mt-1 text-center">
            Choose a new password for your admin account
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-card border border-border p-6">
          {status === "checking" ? (
            <p className="text-body text-ink-secondary text-center py-4">
              Verifying reset link…
            </p>
          ) : status === "invalid" ? (
            <div>
              <h2 className="text-headline font-semibold text-ink mb-2">
                Link expired
              </h2>
              <p className="text-body text-ink-secondary mb-5">
                This reset link is invalid or has expired. Please request a new
                one.
              </p>
              <Link
                href="/forgot-password"
                className="flex h-9 w-full items-center justify-center rounded-control bg-primary text-body font-semibold text-white hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Request New Link
              </Link>
            </div>
          ) : done ? (
            <div>
              <h2 className="text-headline font-semibold text-ink mb-2">
                Password updated
              </h2>
              <p className="text-body text-ink-secondary mb-5">
                Your password has been reset. Please sign in with your new
                password.
              </p>
              <Link
                href="/login"
                className="flex h-9 w-full items-center justify-center rounded-control bg-primary text-body font-semibold text-white hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-body font-medium text-ink mb-1.5">
                  New Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full h-9 rounded-control border border-border-strong bg-surface px-3 text-body text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-2"
                />
              </div>
              <div>
                <label className="block text-body font-medium text-ink mb-1.5">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="w-full h-9 rounded-control border border-border-strong bg-surface px-3 text-body text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-2"
                />
              </div>

              {error && (
                <p className="text-body text-status-danger-text">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
              >
                {loading ? "Updating…" : "Update Password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
