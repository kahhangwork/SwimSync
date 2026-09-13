// Parent Requests (claims) — Postgres function calls. Thin wrappers returning
// the raw { data, error }; the page's error handling is unchanged.

import { supabase } from "@/lib/supabase";

// ⚠ AN RPC, NOT A JOIN, AND THE REASON IS NOT PERFORMANCE. Embedding
// parents(profiles(...)) returns the parent under service role and NULL under
// the admin's own RLS, so every requester showed as "—" on the one screen whose
// job is "who is asking?". list_student_claims() is SECURITY DEFINER and filters
// each row by is_tenant_admin() against that claim's own tenant.
export function listClaims() {
  return supabase.rpc("list_student_claims");
}

// FAMILY-grain payment chip beside the claimant. Fire-and-forget: a failed RPC
// only means no chip. The pure fold lives in domain/.
export function loadLiveBalances() {
  return supabase.rpc("package_live_balances");
}

export function approveClaim(claimId: string) {
  return supabase.rpc("approve_student_claim", { p_claim_id: claimId });
}

export function renameStudent(studentId: string, newName: string) {
  return supabase.rpc("rename_student", {
    p_student_id: studentId,
    p_new_name: newName,
  });
}

export function declineClaim(claimId: string) {
  return supabase.rpc("decline_student_claim", { p_claim_id: claimId });
}

export function undoClaim(claimId: string) {
  return supabase.rpc("undo_student_claim", { p_claim_id: claimId });
}
