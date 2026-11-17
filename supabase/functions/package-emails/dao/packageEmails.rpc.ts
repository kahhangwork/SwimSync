// package-emails' authorisation calls — asked AS THE CALLER, via their own JWT
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B11). They take CallerDb ONLY: passing the
// service client here is a compile error (RISK 5).
//
// ORCHESTRATE, NEVER REPLACE: is_platform_admin / has_admin_area are the single
// definition of who may act; never re-derive either in TypeScript.

import type { CallerDb } from "../../_shared/clientBrands.ts";

export function getCallerUser(anon: CallerDb) {
  return anon.auth.getUser();
}

export function isPlatformAdmin(anon: CallerDb) {
  return anon.rpc("is_platform_admin");
}

export function hasPackagesEdit(anon: CallerDb, tenantId: string) {
  return anon.rpc("has_admin_area", { p_tenant: tenantId, p_area: "packages", p_level: "edit" });
}
