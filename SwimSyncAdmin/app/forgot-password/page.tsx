"use client";

// UI restyle step 4.7 (DESIGN.md): Ground, a flat 8px card, 36px inputs (Border
// Strong, Lane Blue focus), the shared Button, the error in Danger text. Words,
// the submit button and what it does are unchanged.
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { useForgotPassword } from "./domain/useForgotPassword";

export default function ForgotPasswordPage() {
  const { email, setEmail, error, loading, sent, handleSend } =
    useForgotPassword();

  return (
    <div className="min-h-screen flex items-center justify-center bg-ground px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" className="mb-3" />
          <h1 className="text-display font-semibold text-ink">Reset Password</h1>
          <p className="text-body text-ink-secondary mt-1 text-center">
            We&apos;ll email you a link to reset your password
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-card border border-border p-6">
          {sent ? (
            <div>
              <h2 className="text-headline font-semibold text-ink mb-2">
                Check your email
              </h2>
              <p className="text-body text-ink-secondary mb-5">
                If an account exists for {email.trim()}, we&apos;ve sent a link to
                reset your password. Open it on this device to continue.
              </p>
              <Link
                href="/login"
                className="flex h-9 w-full items-center justify-center rounded-control bg-primary text-body font-semibold text-white hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="block text-body font-medium text-ink mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  placeholder="admin@swimsync.sg"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                {loading ? "Sending…" : "Send Reset Link"}
              </Button>

              <Link
                href="/login"
                className="block text-center text-body font-medium text-primary hover:underline underline-offset-2"
              >
                Back to Sign In
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
