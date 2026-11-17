// The run log's one write (runLog.ts recordRuns), moved verbatim
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B2). recordRuns keeps its never-throw contract
// around this call.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";

export function insertRunRows(
  supabase: SupabaseClient<Database>,
  rows: Database["public"]["Tables"]["billing_runs"]["Insert"][],
) {
  return supabase.from("billing_runs").insert(rows);
}
