// Roles page — pure mapping. No React, no network. Carries unit tests.

import { ADMIN_AREAS, NO_ACCESS, type Grid } from "@/lib/permissions";

export type RoleRow = {
  id: string;
  name: string;
  standardKey: string | null;
  grid: Grid;
  holders: number;
};

export function toRoleRows(
  roles: { id: string; name: string; standard_key: string | null }[],
  perms: { role_id: string; area: string; level: string }[],
  holders: { admin_role_id: string | null }[]
): RoleRow[] {
  const counts = new Map<string, number>();
  for (const h of holders) {
    if (h.admin_role_id) counts.set(h.admin_role_id, (counts.get(h.admin_role_id) ?? 0) + 1);
  }
  const grids = new Map<string, Grid>(roles.map((r) => [r.id, { ...NO_ACCESS }]));
  for (const p of perms) {
    const g = grids.get(p.role_id);
    if (g && (ADMIN_AREAS as readonly string[]).includes(p.area)) g[p.area as keyof Grid] = p.level as Grid[keyof Grid];
  }
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    standardKey: r.standard_key,
    grid: grids.get(r.id)!,
    holders: counts.get(r.id) ?? 0,
  }));
}

/** The four seeded roles, with a one-line purpose each (D5). */
export const STANDARD_BLURB: Record<string, string> = {
  full_admin: "Everything, including money and admin management.",
  operations_assistant: "Runs lessons and families, and the business profile. No money.",
  front_desk: "Runs lessons and families. No money, no settings.",
  co_admin_as_before: "Exactly what co-admins could do before roles — everything except Accounting and admin management.",
};
