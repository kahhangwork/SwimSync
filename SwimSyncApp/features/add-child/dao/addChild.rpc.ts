// The ONE write path for adding a child — `add_child_or_claim`
// (docs/refactor/BATCH_FGH_PLAN.md, App L-F). The argument object is built at
// the call site in domain/useAddChild exactly as before; this only sends it.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export type AddChildArgs = {
  p_tenant_id: string | null;
  p_full_name: string;
  p_date_of_birth: string;
  p_gender: string;
  p_notes: string | null;
  p_mode: "check" | "claim_confirmed" | "claim_unsure" | "create_anyway";
  p_candidate_id: string | null;
};

export const addChildOrClaim = (args: AddChildArgs) =>
  supabase.rpc("add_child_or_claim", args);
