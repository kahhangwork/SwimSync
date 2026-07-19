"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { hasTenant, scopeForPath } from "@/lib/adminNav";
import { PageHeader } from "@/components/PageHeader";

/**
 * Gate for the pages that show ONE business.
 *
 * A platform admin belongs to no business, and RLS gives them every row of
 * every table across every tenant — so those pages do not fail for them, they
 * render several businesses' data as though it were one. The dashboard
 * counting students and labelling it "Across all coaches" is the clearest
 * example: it is really across all *businesses*. An error teaches you a page is
 * not for you; a page that quietly sums two schools together looks
 * authoritative and is wrong.
 *
 * THIS EARLY-RETURNS ON PURPOSE, AND THAT IS THE WHOLE GUARD.
 * Rendering the notice *above* `children` would leave the page mounted: its
 * effects still run, its queries still fire, and its tables still paint
 * underneath. The cross-tenant rows would still be on screen, and a test
 * looking for the notice would pass anyway — the false-pass shape of §7.10. An
 * unmounted child cannot query, so unmounting is the mechanism rather than a
 * rule someone has to remember.
 *
 * For the same reason `undefined` (still resolving) renders the loader and NOT
 * the children: painting real rows for a beat before replacing them is a leak
 * with a short duration, not an absence of one.
 *
 * Applied once in the (admin) layout and keyed off each route's `scope` in
 * lib/adminNav.ts — the same declaration the sidebar renders from, so a page
 * cannot be listed as a business page and gated as something else. Hiding links
 * is the affordance; this is the boundary. A hidden link is still a URL.
 */
export function RequiresTenant({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // undefined = still resolving. Distinct from null (= resolved, no business).
  const [tenantId, setTenantId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return; // AuthGuard owns the signed-out case.
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", auth.user.id)
        .maybeSingle();
      // tenant_id, never role — a private coach is a tenant_admin who also
      // teaches, and telling them they administer no business is §7.19 again.
      if (!cancelled) setTenantId((profile?.tenant_id as string | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const needsTenant = scopeForPath(pathname) === "tenant";
  const resolved = tenantId !== undefined;
  const refused = resolved && needsTenant && !hasTenant(tenantId);

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
