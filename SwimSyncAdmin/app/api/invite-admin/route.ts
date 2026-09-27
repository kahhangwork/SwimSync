import { NextRequest, NextResponse } from "next/server";
import { requireArea } from "@/lib/adminManagementGate";
import { sendCoAdminInviteEmail } from "@/lib/coAdminInviteEmail";
import { mintStaffInvitation } from "@/lib/staffInvitation";

/**
 * An admin with Admins & roles: Edit invites a co-admin into their own
 * business, on a ROLE (P4). Owner-only until 2026-09-27; since roles, a
 * co-admin may invite too, but only onto a role no stronger than their own
 * (can_assign_role) — so inviting allies cannot out-rank the inviter, and the
 * owner is never reachable (owner-target rule, 20260927000600).
 *
 * Mechanically this is provision-tenant's step 2 without the tenant creation:
 * generateLink({type:'invite'}) with the role metadata the auth trigger reads
 * (it builds the profiles row, and the coaches row when isCoach), then our own
 * email via Resend. The tenant_id in the metadata is the CALLER's, never the
 * body's. A co-admin invited this way does NOT become the owner —
 * handle_new_user's ownership claim is guarded on owner_profile_id IS NULL.
 */
export async function POST(req: NextRequest) {
  const gate = await requireArea(req, "admins", "edit");
  if (!gate.ok) return gate.response;
  const { tenantId, adminClient, callerId, callerClient } = gate;

  const { name, email: rawEmail, phone, isCoach, roleId } = await req.json();
  if (!name?.trim() || !rawEmail?.trim()) {
    return NextResponse.json(
      { error: "name and email are required" },
      { status: 400 }
    );
  }
  const email = String(rawEmail).trim().toLowerCase();

  // P4: every invite names a role, and the caller must be allowed to give it —
  // the owner any role, a co-admin with admins:edit only one no stronger than
  // their own. Asked of the database as the caller (can_assign_role).
  if (!roleId) {
    return NextResponse.json({ error: "Choose a role for the new admin." }, { status: 400 });
  }
  const { data: mayAssign } = await callerClient.rpc("can_assign_role", { p_role_id: roleId });
  if (mayAssign !== true) {
    return NextResponse.json(
      { error: "You can only give a role that is no stronger than your own." },
      { status: 403 }
    );
  }

  // "The invite didn't arrive, try again" must route to Resend, not mint a
  // second account (provision-tenant's rule).
  const { data: existing } = await adminClient
    .from("profiles")
    .select("id, role, tenant_id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.role === "tenant_admin" && existing.tenant_id === tenantId
            ? "That email is already one of your admins. If their invite never arrived, use Resend invite on their row."
            : "That email is already in use by another SwimSync account.",
      },
      { status: 409 }
    );
  }

  const { data: tenant } = await adminClient
    .from("tenants")
    .select("display_name")
    .eq("id", tenantId)
    .single();

  // The auth trigger grants tenant_admin ONLY against this row, not from
  // the metadata below (20260927000200 — a public signUp sets metadata too).
  const invitation = await mintStaffInvitation(adminClient, {
    email,
    role: "tenant_admin",
    tenantId,
    isCoach: Boolean(isCoach),
    createdBy: callerId,
    adminRoleId: roleId,
  });
  if (!invitation.ok) {
    return NextResponse.json({ error: invitation.error }, { status: 500 });
  }

  const { data: link, error: linkErr } =
    await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        // The auth trigger builds profiles (+ coaches when is_coach) from
        // the invitation row; role / tenant_id / is_coach here are kept for
        // display and for the trusted direct-SQL path only.
        data: {
          invitation_nonce: invitation.nonce,
          role: "tenant_admin",
          full_name: name.trim(),
          tenant_id: tenantId,
          is_coach: Boolean(isCoach),
        },
        redirectTo: `${new URL(req.url).origin}/accept-invite`,
      },
    });

  if (linkErr || !link?.properties?.action_link) {
    return NextResponse.json(
      { error: linkErr?.message ?? "Could not generate an invite link" },
      { status: 500 }
    );
  }

  // The trigger already made the profile; phone is the one field it doesn't
  // carry. Service-role write; the guard trigger pins role/tenant/disabled,
  // not phone.
  if (phone?.trim()) {
    await adminClient
      .from("profiles")
      .update({ phone: phone.trim() })
      .eq("email", email);
  }

  const sendResult = await sendCoAdminInviteEmail({
    apiKey: process.env.RESEND_API_KEY,
    to: email,
    adminName: name.trim(),
    businessName: tenant?.display_name ?? "your business",
    actionLink: link.properties.action_link,
  });

  // A failed email is a warning, not a failure: the account exists and the
  // owner can pass the link on by hand (provision-tenant's convention).
  return NextResponse.json({
    success: true,
    adminEmail: email,
    emailSent: sendResult.sent,
    emailReason: sendResult.reason ?? null,
    inviteLink: sendResult.sent ? null : link.properties.action_link,
  });
}
