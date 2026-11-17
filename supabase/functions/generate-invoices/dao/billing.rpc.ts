// The billing engine's Postgres-function calls, moved verbatim out of core.ts
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B2).
//
// ORCHESTRATE, NEVER REPLACE: apply_credit_to_invoice locks the balance row and the
// notes FOR UPDATE and draws FIFO in ONE transaction (20260818000200). Calling it is
// the only correct way to draw credit; never re-implement any part of it here or in
// the engine.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";

export function applyCreditToInvoice(supabase: SupabaseClient<Database>, invoice: { id: string }) {
  return supabase.rpc(
        "apply_credit_to_invoice",
        { p_invoice_id: invoice.id }
      );
}
