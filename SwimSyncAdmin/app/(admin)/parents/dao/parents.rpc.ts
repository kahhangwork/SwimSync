// Parents page — Postgres function calls, and the client-taking lib/ helpers
// bound here so the page and its hooks never see the supabase client. These
// ORCHESTRATE lib helpers; they never replace what the helper does.

import { supabase } from "@/lib/supabase";
import { setFamilyActive } from "@/lib/studentStatus";

// Family-grain live package balances (one row per parent/product with a live
// package). The pure fold into a per-parent Map lives in domain/.
export function loadLiveBalances() {
  return supabase.rpc("package_live_balances");
}

// Set a family active/inactive AT THIS BUSINESS. `childIds` cascades the change
// to those children (deactivation only); reactivation passes []. Returns
// { error: string | null } exactly as the lib helper does.
export function setFamilyActiveDao(
  parentId: string,
  tenantId: string,
  active: boolean,
  childIds: string[]
) {
  return setFamilyActive(supabase, parentId, tenantId, active, childIds);
}
