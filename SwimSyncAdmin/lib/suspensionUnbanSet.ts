/**
 * The unsuspend route's unban set — ⚠ RISK 3 (WAVE_5_PLAN.md chunk 3).
 *
 * (staff of tenant) MINUS (individually disabled). A naive mirror of the
 * suspend route's ban set would permanently resurrect logins that
 * deactivate-admin or disable-coach killed:
 *   - an admin (or admin-who-coaches) with admin_disabled_at set stays banned;
 *   - a PURE coach whose coaches.disabled_at is set stays banned — their
 *     login IS their coach half.
 *
 * Pure function so the exclusion rule is unit-testable away from the auth
 * admin API; /api/unsuspend-tenant feeds it the two plain queries' rows.
 */

export type StaffProfile = {
  id: string;
  email: string | null;
  role: "tenant_admin" | "coach";
  admin_disabled_at: string | null;
};

export function suspensionUnbanSet(
  staff: StaffProfile[],
  disabledCoachProfileIds: Iterable<string>
): StaffProfile[] {
  const disabledCoaches = new Set(disabledCoachProfileIds);
  return staff.filter((s) => {
    if (s.role === "tenant_admin") return s.admin_disabled_at === null;
    return !disabledCoaches.has(s.id);
  });
}
