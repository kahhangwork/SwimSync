// The invoice-email claim (email.ts claimInvoiceEmail), moved verbatim
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B3).
//
// ORCHESTRATE, NEVER REPLACE: claim_invoice_email row-locks, computes the email state
// in SQL and claims only UNSENT / RETRYABLE (or MAY_HAVE_SENT when manual). It is what
// makes a double send impossible; never re-derive the state in TypeScript.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";

export function claimInvoiceEmailRpc(supabase: SupabaseClient<Database>, invoiceId: string, manual: boolean) {
  return supabase.rpc("claim_invoice_email", {
    p_invoice_id: invoiceId,
    p_manual: manual,
  });
}
