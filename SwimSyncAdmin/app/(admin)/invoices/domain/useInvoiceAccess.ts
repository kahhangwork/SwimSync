"use client";

import { usePermissions } from "@/components/PermissionsProvider";
import { can } from "@/lib/permissions";

/** What the signed-in admin may do on the Invoices page beyond reading it.
 *  change_invoice_due_date() refuses all but billing EDIT, and a platform admin
 *  belongs to no business (has_admin_area is false for them) — the menu item
 *  follows the server, so it never offers a press that can only be refused. */
export function useInvoiceAccess(isPlatformAdmin: boolean) {
  const { perms } = usePermissions();
  return { canChangeDue: can(perms, "billing", "edit") && !isPlatformAdmin };
}
