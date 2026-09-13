// Parents page — pure row→entity mapping, filter, and count. No React, no
// network. Kept pure so it carries the page's unit tests (parentsRows.test.ts).

import type { FamilyRow } from "../types";

// Combine the parent_tenants rows with their parent_students children, keeping
// only children AT THIS BUSINESS. A sibling elsewhere is another admin's concern
// and must not be actionable from here.
export function toFamilyRows(rows: any[], kids: any[]): FamilyRow[] {
  return rows.map((r) => {
    const profile = r.parents?.profiles ?? {};
    return {
      parent_id: r.parent_id,
      tenant_id: r.tenant_id,
      full_name: profile.full_name ?? "—",
      email: profile.email ?? "—",
      phone: profile.phone ?? null,
      is_active: r.is_active,
      inactivated_at: r.inactivated_at,
      children: (kids ?? [])
        .filter(
          (k: any) =>
            k.parent_id === r.parent_id && k.students?.tenant_id === r.tenant_id
        )
        .map((k: any) => ({
          id: k.students.id,
          full_name: k.students.full_name,
          is_active: k.students.is_active,
        })),
    };
  });
}

export const activeChildCount = (f: FamilyRow) =>
  f.children.filter((c) => c.is_active).length;

export function filterFamilies(
  families: FamilyRow[],
  search: string,
  showInactive: boolean
): FamilyRow[] {
  return families.filter((f) => {
    const matchSearch =
      f.full_name.toLowerCase().includes(search.toLowerCase()) ||
      f.email.toLowerCase().includes(search.toLowerCase());
    return matchSearch && (showInactive || f.is_active);
  });
}
