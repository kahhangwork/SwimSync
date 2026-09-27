import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mint the server-side proof that a staff auth user is invited
 * (20260927000200_staff_accounts_by_invitation).
 *
 * handle_new_user() grants coach / tenant_admin ONLY to an auth-API user whose
 * metadata carries the nonce of an unconsumed, unexpired row here for the same
 * email — role, business and is_coach come from the ROW. Before that migration
 * the trigger trusted `role` / `tenant_id` from user metadata, which a public
 * signUp() also sets, so anyone could register as staff (or platform admin).
 *
 * Call it immediately before generateLink / createUser and pass the returned
 * nonce as `invitation_nonce` in the user metadata. The row expires in 15
 * minutes and is consumed by the trigger inside that same call, so a failed
 * request leaves nothing that needs cleaning up.
 */
export async function mintStaffInvitation(
  adminClient: SupabaseClient,
  invite: {
    email: string;
    role: "coach" | "tenant_admin";
    tenantId: string;
    isCoach?: boolean;
    createdBy?: string | null;
  },
): Promise<{ ok: true; nonce: string } | { ok: false; error: string }> {
  const nonce = randomBytes(32).toString("hex");
  const { error } = await adminClient.from("staff_invitations").insert({
    nonce,
    email: invite.email.trim().toLowerCase(),
    role: invite.role,
    tenant_id: invite.tenantId,
    is_coach: Boolean(invite.isCoach),
    created_by: invite.createdBy ?? null,
  });
  if (error) return { ok: false, error: `Could not create the invitation: ${error.message}` };
  return { ok: true, nonce };
}
