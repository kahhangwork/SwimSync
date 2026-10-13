"use client";

// UI restyle step 4.7 (DESIGN.md): Ground, a flat 8px card, 36px inputs (Border
// Strong, Lane Blue focus), the shared Button, the error in Danger text. Words,
// the submit button and what it does are unchanged.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { useLogin } from "./domain/useLogin";

export default function LoginPage() {
  const router = useRouter();
  const { email, setEmail, password, setPassword, error, loading, handleLogin } =
    useLogin();

  return (
    <div className="min-h-screen flex items-center justify-center bg-ground px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" className="mb-3" />
          <h1 className="text-display font-semibold text-ink">SwimSync Admin</h1>
          <p className="text-body text-ink-secondary mt-1">Superadmin access only</p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-card border border-border p-6">
          <h2 className="text-headline font-semibold text-ink mb-5">Sign In</h2>

          <form
            onSubmit={(e) => handleLogin(e, (href) => router.push(href))}
            className="space-y-4"
          >
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
            <div>
              <label className="block text-body font-medium text-ink mb-1.5">
                Password
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
              {loading ? "Signing in…" : "Sign In"}
            </Button>

            <Link
              href="/forgot-password"
              className="block text-center text-body font-medium text-primary hover:underline underline-offset-2"
            >
              Forgot password?
            </Link>
          </form>
        </div>
      </div>
    </div>
  );
}
