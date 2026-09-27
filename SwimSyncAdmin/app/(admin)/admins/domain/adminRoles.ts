// Admins page — which roles the signed-in admin may hand out. Pure; tested.
//
// DISPLAY ONLY. The boundary is the database: assign_admin_role and the
// invite-admin route's can_assign_role refuse a role stronger than the
// caller's (ROLES_PERMISSIONS_PLAN.md §5.4). This only keeps the picker from
// offering a choice that would be refused.

import { ADMIN_AREAS, isWithin, NO_ACCESS, type Grid } from "@/lib/permissions";
import type { RoleOption } from "../types";

type RoleRow = { id: string; name: string; standard_key: string | null };
type PermRow = { role_id: string; area: string; level: string };

export function toRoleOptions(roles: RoleRow[], perms: PermRow[]): RoleOption[] {
  const grids = new Map<string, Grid>();
  for (const r of roles) grids.set(r.id, { ...NO_ACCESS });
  for (const p of perms) {
    const g = grids.get(p.role_id);
    if (g && (ADMIN_AREAS as readonly string[]).includes(p.area)) {
      g[p.area as keyof Grid] = p.level as Grid[keyof Grid];
    }
  }
  return roles
    .map((r) => ({ id: r.id, name: r.name, standardKey: r.standard_key, grid: grids.get(r.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The owner may give any role; anyone else only a role within their own grid. */
export function assignableRoles(roles: RoleOption[], isOwner: boolean, callerGrid: Grid): RoleOption[] {
  return isOwner ? roles : roles.filter((r) => isWithin(r.grid, callerGrid));
}

/** P4: the invite form preselects Front desk — the weakest standard role —
 *  when the caller may give it, else the first role they may give. */
export function defaultInviteRoleId(assignable: RoleOption[]): string | null {
  return (assignable.find((r) => r.standardKey === "front_desk") ?? assignable[0])?.id ?? null;
}
