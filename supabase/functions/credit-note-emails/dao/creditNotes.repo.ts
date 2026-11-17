// credit-note-emails' table reads and the settle write, moved verbatim out of core.ts
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B12). Service client: RLS does not apply, so the
// tenant filters in these chains ARE the isolation (RISK 3).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import { NOTE_SELECT } from "./noteSelect.ts";

type Db = SupabaseClient<Database>;

export function readUnsentBySession(svc: Db, lessonSessionId: string, tenantId: string) {
  return svc
    .from("credit_notes")
    .select(NOTE_SELECT)
    .eq("lesson_session_id", lessonSessionId)
    .eq("tenant_id", tenantId) // ⚠ RISK 3
    .in("credit_note_email_state", ["UNSENT", "RETRYABLE"]);
}

export function readUnsentById(svc: Db, creditNoteId: string) {
  return svc
    .from("credit_notes")
    .select(NOTE_SELECT)
    .eq("id", creditNoteId)
    .is("email_sent_at", null)
    .maybeSingle();
}

export function readLiveApplications(svc: Db, noteIds: string[]) {
  return svc
    .from("credit_applications")
    .select("credit_note_id")
    .is("reversed_at", null)
    .in("credit_note_id", noteIds);
}

export function readEmailedSiblings(svc: Db, invoiceItemIds: string[]) {
  return svc
    .from("credit_notes")
    .select("invoice_item_id")
    .in("invoice_item_id", invoiceItemIds)
    .not("email_sent_at", "is", null);
}

export function readTenantSuspendedAt(svc: Db, tenantId: string) {
  return svc
    .from("tenants")
    .select("suspended_at")
    .eq("id", tenantId)
    .maybeSingle();
}

export function readCreditBalances(svc: Db, tenantId: string, parentIds: string[]) {
  return svc
    .from("parent_tenant_balances")
    .select("parent_id, credit_balance")
    .eq("tenant_id", tenantId)
    .in("parent_id", parentIds);
}

/** Conditional on the settle token — see settleNote. */
export function settleNoteRow(
  svc: Db,
  patch: Database["public"]["Tables"]["credit_notes"]["Update"],
  noteId: string,
  claimedAt: string,
) {
  return svc
      .from("credit_notes")
      .update(patch)
      .eq("id", noteId)
      .eq("email_claimed_at", claimedAt);
}
