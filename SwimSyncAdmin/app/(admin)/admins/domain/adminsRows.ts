// Admins page — pure mapping. No React, no network. Carries unit tests.

import type { AdminRow } from "../types";

export function toAdminRows(
  profiles: any[],
  ownerId: string | null,
  coachIds: Set<string>
): AdminRow[] {
  return (profiles ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    phone: p.phone,
    isOwner: p.id === ownerId,
    isCoach: coachIds.has(p.id),
    // Deactivation is client-readable; invited-vs-active is not (yet null).
    status: p.admin_disabled_at ? ("deactivated" as const) : null,
  }));
}

// Phase-2 merge: fold the auth-layer statuses in, keeping the existing value
// when the server row is missing.
export function mergeStatuses(rows: AdminRow[], apiAdmins: AdminRow[]): AdminRow[] {
  const statusById = new Map<string, AdminRow["status"]>(
    apiAdmins.map((a) => [a.id, a.status])
  );
  return rows.map((r) => ({ ...r, status: statusById.get(r.id) ?? r.status }));
}
