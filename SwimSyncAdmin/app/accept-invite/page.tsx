"use client";

// UI restyle step 4.7 (DESIGN.md): Ground, a flat 8px card, 36px inputs (Border
// Strong, Lane Blue focus), the shared Button, the error in Danger text. Words,
// the submit button and what it does are unchanged.
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { useAcceptInvite } from "./domain/useAcceptInvite";

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
  const {
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
  } = useAcceptInvite();

  return (
    <div className="min-h-screen flex items-center justify-center bg-ground px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" className="mb-3" />
          <h1 className="text-display font-semibold text-ink">
            Welcome to SwimSync
          </h1>
          <p className="text-body text-ink-secondary mt-1 text-center">
            {business
              ? `Choose a password to start running ${business}`
              : "Choose a password to get started"}
          </p>
        </div>

        <div className="bg-surface rounded-card border border-border p-6">
          {status === "checking" ? (
            <p className="text-body text-ink-secondary text-center py-4">
              Checking your invite…
            </p>
          ) : status === "invalid" ? (
            <div>
              <h2 className="text-headline font-semibold text-ink mb-2">
                This invite has expired
              </h2>
              <p className="text-body text-ink-secondary mb-5">
                Invite links can only be used once. Ask your SwimSync contact to
                send you a new one — you don&apos;t need to do anything else.
              </p>
              <Link
                href="/login"
                className="flex h-9 w-full items-center justify-center rounded-control bg-primary text-body font-semibold text-white hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Back to Sign In
              </Link>
            </div>
          ) : done ? (
            <div>
              <h2 className="text-headline font-semibold text-ink mb-2">
                You&apos;re all set
              </h2>
              <p className="text-body text-ink-secondary mb-5">
                Your password has been saved. Sign in to set up your classes and
                start adding students.
              </p>
              <Link
                href="/login"
                className="flex h-9 w-full items-center justify-center rounded-control bg-primary text-body font-semibold text-white hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-body font-medium text-ink mb-1.5">
                  Choose a Password
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
                  Confirm Password
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
                <p role="alert" className="text-body text-status-danger-text">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
              >
                {loading ? "Saving…" : "Set Password & Continue"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
