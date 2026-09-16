// Postgres function calls for the Invoices page — thin wrappers returning the
// raw `{ data, error }`. Tier rule: dao/ imports the client and @/lib pure
// helpers only.
//
// ⚠ ORCHESTRATE, NEVER REPLACE. These RPCs are the ONE mark-paid / settlement /
// write-off path shared with every client (PRD §7.21). Do not reimplement their
// logic here or on the page — the atomic writes (status + paid_at +
// paid_marked_by + the payment_records / audit rows) live in the function.

import { supabase } from "@/lib/supabase";

/** The standing orphan-lesson report (Wave 4). Server-computed: the predicate
 *  ("billable, inside a sealed month, no invoice line, no live settlement")
 *  lives in unbilled_sealed_lessons() where pgTAP pins it — not re-derived in
 *  the client, where it would drift. */
export const unbilledSealedLessons = (tenantId: string) =>
  supabase.rpc("unbilled_sealed_lessons", { p_tenant: tenantId });

export const writeOffParentBalance = (
  parentId: string,
  tenantId: string,
  reason: string
) =>
  supabase.rpc("write_off_parent_balance", {
    p_parent_id: parentId,
    p_tenant_id: tenantId,
    p_reason: reason,
  });

// ONE mark-paid path for every client (PRD §7.21): the RPC writes status +
// paid_at + paid_marked_by + the payment_records audit row atomically. The
// page's old direct UPDATE wrote neither audit field.
export const confirmInvoicePaid = (invoiceId: string) =>
  supabase.rpc("confirm_invoice_paid", { p_invoice_id: invoiceId });
