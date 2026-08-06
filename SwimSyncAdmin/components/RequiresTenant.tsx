"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { hasTenant, scopeForPath } from "@/lib/adminNav";
import { PageHeader } from "@/components/PageHeader";

/**
 * Gate for the admin panel's pages. Three questions, in order:
 *
 * 1. MAY THIS ACCOUNT ENTER AT ALL? — answered by ROLE. Only `tenant_admin`
 *    and `platform_admin` are admin-panel accounts; a `coach` or `parent`
 *    account gets "use the SwimSync app". This is a deliberate REVERSAL of the
 *    rule that used to live here ("tenant_id, never role — §7.19"): that rule
 *    was about WHICH PAGES an admin sees, and it still governs question 3. But
 *    a created coach also HAS a tenant_id, so tenant_id cannot answer "is this
 *    an admin at all" — before co-admins existed (20260806000100) a coach who
 *    typed this URL got a half-working read-only panel. The §7.19 lesson is
 *    honoured in the SHAPE of the check: refuse ONLY a RESOLVED profile whose
 *    role is affirmatively a non-admin one — loading, fetch errors and unknown
 *    roles never refuse, because refusing on "not yet known" is exactly how
 *    the real coach got locked out of production once. The private coach
 *    passes: their role IS tenant_admin.
 *
 * 2. IS THIS ADMIN SUSPENDED? — a tenant_admin with admin_disabled_at set has
 *    had their admin authority revoked by the business owner (RLS enforces
 *    that; this screen just says it in words). Only a deactivated coach-admin
 *    can actually reach this — deactivated PURE admins are banned outright.
 *
 * 3. DOES THIS PAGE'S SCOPE MATCH? — tenant pages for business admins,
 *    /platform for the platform admin. Unchanged, still keyed on tenant_id via
 *    lib/adminNav.ts, the same declaration the sidebar renders from.
 *
 * THIS EARLY-RETURNS ON PURPOSE, AND THAT IS THE WHOLE GUARD.
 * Rendering a notice *above* `children` would leave the page mounted: its
 * effects still run, its queries still fire, and its tables still paint
 * underneath — the false-pass shape of §7.10. An unmounted child cannot query,
 * so unmounting is the mechanism rather than a rule someone has to remember.
 *
 * For the same reason `undefined` (still resolving) renders the loader and NOT
 * the children: painting real rows for a beat before replacing them is a leak
 * with a short duration, not an absence of one.
 *
 * Hiding sidebar links is the affordance; RLS is the boundary; this is the
 * honest explanation in between. A hidden link is still a URL.
 */

type GateProfile = {
  role: string | null;
  tenant_id: string | null;
  admin_disabled_at: string | null;
};

export function RequiresTenant({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // undefined = still resolving. Distinct from null (= resolved, no profile).
  const [profile, setProfile] = useState<GateProfile | null | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return; // AuthGuard owns the signed-out case.
      const { data } = await supabase
        .from("profiles")
        .select("role, tenant_id, admin_disabled_at")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (!cancelled) setProfile((data as GateProfile | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolved = profile !== undefined;
  const tenantId = profile?.tenant_id ?? null;

  // Question 1: refuse ONLY an affirmatively non-admin role. A missing
  // profile, an error, or a future role value falls through to the scope
  // logic, which fails closed on its own terms — never to this screen.
  const wrongApp =
    resolved && (profile?.role === "coach" || profile?.role === "parent");

  // Question 2: a suspended tenant_admin.
  const suspended =
    resolved &&
    !wrongApp &&
    profile?.role === "tenant_admin" &&
    !!profile?.admin_disabled_at;

  // Question 3: scope, exactly as before.
  const needsTenant = scopeForPath(pathname) === "tenant";
  const refused =
    resolved && !wrongApp && !suspended && needsTenant && !hasTenant(tenantId);

  // /dashboard is the one route worth redirecting rather than refusing: nobody
  // chooses to visit it, it is where a bookmark or an old link lands, and a
  // platform admin has a real home to go to. Every other page refuses in place,
  // because silently teleporting someone away from a URL they typed is worse
  // than telling them why they can't see it.
  const redirecting = refused && pathname === "/dashboard";
  useEffect(() => {
    if (redirecting) router.replace("/platform");
  }, [redirecting, router]);

  if (!resolved || redirecting) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }

  if (wrongApp) {
    return (
      <div>
        <PageHeader title="Not this app" />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          <p className="mb-2 font-semibold text-gray-900">
            This is the admin panel.
          </p>
          <p>
            Your account is a {profile?.role === "coach" ? "coach" : "parent"}{" "}
            account — please use the SwimSync app instead. Marking attendance,
            your classes and your pay all live there.
          </p>
        </div>
      </div>
    );
  }

  if (suspended) {
    return (
      <div>
        <PageHeader title="Access suspended" />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          <p className="mb-2 font-semibold text-gray-900">
            Your admin access has been suspended.
          </p>
          <p>
            The business owner has deactivated your admin account. If you think
            this is a mistake, contact them directly.
          </p>
        </div>
      </div>
    );
  }

  if (refused) {
    return (
      <div>
        <PageHeader title="Not this account" />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          <p className="mb-2 font-semibold text-gray-900">
            This page shows a single business.
          </p>
          <p>
            Your account administers none — it operates the platform. Everything
            cross-tenant lives on{" "}
            <a
              href="/platform"
              className="font-medium text-sky-600 hover:underline"
            >
              Platform
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
