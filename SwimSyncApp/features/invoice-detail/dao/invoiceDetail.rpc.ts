// The one Postgres function the parent Invoice Detail screen calls
// (docs/refactor/BATCH_FGH_PLAN.md, App L-G). Raw builder, byte-identical.
//
// ⚠ features/billing has its OWN claimInvoicePaid for the list card — two dao
// functions on purpose; do NOT deduplicate across features (plan ⚠ R8).
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const claimInvoicePaid = (invoiceId: string) =>
  supabase.rpc("claim_invoice_paid", {
    p_invoice_id: invoiceId,
  });
