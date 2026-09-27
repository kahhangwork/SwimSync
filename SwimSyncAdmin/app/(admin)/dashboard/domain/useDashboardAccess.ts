"use client";

import { usePermissions } from "@/components/PermissionsProvider";
import { can } from "@/lib/permissions";

/**
 * What the signed-in admin's ROLE shows on the dashboard (ROLES_PERMISSIONS_PLAN.md
 * §5.5): each tile only if its area is at least View, and the business card's
 * edits only with Business profile: Edit. The billing-blocked alert is NOT gated —
 * month state, not money (X2), and it tells people to mark.
 */
export function useDashboardAccess() {
  const { perms } = usePermissions();
  return {
    showBilling: can(perms, "billing", "view"),
    canEditProfile: can(perms, "profile", "edit"),
  };
}
