import { useState } from "react";
import { landingRoute } from "@/lib/adminNav";
import {
  loadProfileRole,
  signInWithPassword,
  signOut,
} from "../dao/login.repo";

/**
 * ⚠ The router is NOT held here (BATCH_E_PLAN.md RISK 1). `useRouter()` stays
 * in page.tsx and the caller hands `push` in at call time, so this hook can be
 * reasoned about — and the landing decision read — without Next's navigation
 * context. Login is the front door for 40 UI drivers and every real admin.
 */
export function useLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(
    e: React.FormEvent,
    push: (href: string) => void
  ) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: authError } = await signInWithPassword(
      email,
      password
    );

    if (authError || !data.session) {
      setError(authError?.message ?? "Login failed.");
      setLoading(false);
      return;
    }

    // Verify superadmin role
    const { data: profile } = await loadProfileRole(data.session.user.id);

    // `superadmin` split into tenant_admin (one business) and platform_admin
    // (SwimSync itself, cross-tenant support). Both belong in this panel. A
    // coach or parent is told where they DO belong — "access denied" to
    // someone holding a perfectly good account is a support ticket, not a
    // boundary. (RequiresTenant repeats this refusal for any session that
    // arrives without passing through here.)
    if (profile?.role !== "tenant_admin" && profile?.role !== "platform_admin") {
      await signOut();
      setError(
        profile?.role === "coach" || profile?.role === "parent"
          ? "This is the admin panel — please use the SwimSync app instead."
          : "Access denied. Admin accounts only."
      );
      setLoading(false);
      return;
    }

    // A platform admin has no business, so /dashboard would show them
    // cross-tenant totals labelled as one business. Derived from the SAME fact
    // the sidebar and the page gate use — a second way of asking "which kind of
    // admin is this?" is a second thing to keep in sync, and the two
    // disagreeing is how you get a redirect loop.
    push(landingRoute(profile?.tenant_id as string | null));
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    error,
    loading,
    handleLogin,
  };
}
