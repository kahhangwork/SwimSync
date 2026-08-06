import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/adminManagementGate";
import { sendCoAdminInviteEmail } from "@/lib/coAdminInviteEmail";

/**
 * The OWNER invites a co-admin into their own business. Owner only — a
 * co-admin holding this power could invite allies and outvote the owner's
 * lockout protections.
 *
 * Mechanically this is provision-tenant's step 2 without the tenant creation:
 * generateLink({type:'invite'}) with the role metadata the auth trigger reads
 * (it builds the profiles row, and the coaches row when isCoach), then our own
 * email via Resend. The tenant_id in the metadata is the CALLER's, never the
 * body's. A co-admin invited this way does NOT become the owner —
 * handle_new_user's ownership claim is guarded on owner_profile_id IS NULL.
 */
export async function POST(req: NextRequest) {
  const gate = await requireOwner(req);
  if (!gate.ok) return gate.response;
  const { tenantId, adminClient } = gate;

  const { name, email: rawEmail, phone, isCoach } = await req.json();
  if (!name?.trim() || !rawEmail?.trim()) {
    return NextResponse.json(
      { error: "name and email are required" },
      { status: 400 }
    );
  }
  const email = String(rawEmail).trim().toLowerCase();

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

  const { data: link, error: linkErr } =
    await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        // The auth trigger builds profiles (+ coaches when is_coach) from
        // this. is_coach here is "this co-admin also teaches" — same shape as
        // the private-coach owner.
        data: {
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
