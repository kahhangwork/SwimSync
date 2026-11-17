// credit-note-emails' Postgres-function calls (EDGE_FUNCTIONS_REFACTOR_PLAN.md B12),
// moved verbatim out of core.ts and index.ts.
//
// The claim runs as the SERVICE client. Every authorisation call runs AS THE CALLER,
// via their own JWT, and takes CallerDb ONLY — passing the service client to one is
// a compile error (RISK 5). ORCHESTRATE, NEVER REPLACE: claim_credit_note_email,
// session_tenant, coach_is_main_on_session, is_platform_admin and has_admin_area are
// the single definitions; never re-derive any of them in TypeScript.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import type { CallerDb } from "../../_shared/clientBrands.ts";

export function claimNoteRpc(svc: SupabaseClient<Database>, noteId: string, manual: boolean) {
  return svc.rpc("claim_credit_note_email", {
    p_credit_note_id: noteId,
    p_manual: manual,
  });
}

// ── As the caller ───────────────────────────────────────────────────────────
export function getCallerUser(anon: CallerDb) {
  return anon.auth.getUser();
}

export function sessionTenant(anon: CallerDb, lesson_session_id: string) {
  return anon.rpc("session_tenant", {
        p_session_id: lesson_session_id,
      });
}

export function coachIsMainOnSession(anon: CallerDb, lesson_session_id: string) {
  return anon.rpc("coach_is_main_on_session", { p_session_id: lesson_session_id });
}

export function isPlatformAdmin(anon: CallerDb) {
  return anon.rpc("is_platform_admin");
}

export function hasOperationsEdit(anon: CallerDb, tenantId: string) {
  return anon.rpc("has_admin_area", { p_tenant: tenantId, p_area: "operations", p_level: "edit" });
}

export function hasBillingEdit(anon: CallerDb, tenantId: string) {
  return anon.rpc("has_admin_area", {
        p_tenant: tenantId,
        p_area: "billing",
        p_level: "edit",
      });
}
