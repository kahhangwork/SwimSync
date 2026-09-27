"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NO_ACCESS, permissionsFromRows, type Permissions } from "@/lib/permissions";

/**
 * The signed-in admin's role, loaded ONCE for the whole admin panel
 * (ROLES_PERMISSIONS_PLAN.md §5.5 — before this, each component loaded its own
 * profile). The sidebar filters on it, RequiresTenant refuses on it, pages hide
 * edit controls on it.
 *
 * It is an AFFORDANCE: every policy and RPC asks has_admin_area() itself. So
 * this reads the server's answer (my_admin_permissions) and never re-derives
 * the rule — the owner arrives as all-edit because the RPC says so.
 *
 * `status: "loading"` is distinct from "no access": RequiresTenant renders its
 * loader, never the refusal, until this resolves (the §7.19 lesson — refusing
 * on "not yet known" is how a real admin got locked out once).
 */
export type PermissionsState = {
  status: "loading" | "ready";
  tenantId: string | null;
  isOwner: boolean;
  perms: Permissions;
};

const LOADING: PermissionsState = {
  status: "loading",
  tenantId: null,
  isOwner: false,
  perms: { levels: NO_ACCESS },
};

const PermissionsContext = createContext<PermissionsState>(LOADING);

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PermissionsState>(LOADING);

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
      const tenantId = (profile?.tenant_id as string | null) ?? null;
      if (!tenantId) {
        if (!cancelled) setState({ status: "ready", tenantId: null, isOwner: false, perms: { levels: NO_ACCESS } });
        return;
      }
      const [{ data: rows }, { data: tenant }] = await Promise.all([
        supabase.rpc("my_admin_permissions", { p_tenant: tenantId }),
        supabase.from("tenants").select("owner_profile_id").eq("id", tenantId).maybeSingle(),
      ]);
      if (cancelled) return;
      setState({
        status: "ready",
        tenantId,
        isOwner: tenant?.owner_profile_id === auth.user.id,
        perms: permissionsFromRows(rows as { area: string; level: string }[] | null),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <PermissionsContext.Provider value={state}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsState {
  return useContext(PermissionsContext);
}
