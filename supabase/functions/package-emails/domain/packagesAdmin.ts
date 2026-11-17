// Roles (20260927000500): offering a package or granting a referral reward is
// a packages:edit act. The platform admin keeps the arm can_admin_tenant gave
// it (P7). Asked AS THE CALLER, via their own JWT. Moved verbatim out of index.ts
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B11); it takes CallerDb only.

import type { CallerDb } from "../../_shared/clientBrands.ts";
import { hasPackagesEdit, isPlatformAdmin } from "../dao/packageEmails.rpc.ts";

export async function packagesAdmin(
  anon: CallerDb,
  tenantId: string,
): Promise<boolean> {
  const [{ data: isPlatform }, { data: hasArea }] = await Promise.all([
    isPlatformAdmin(anon),
    hasPackagesEdit(anon, tenantId),
  ]);
  return isPlatform === true || hasArea === true;
}
