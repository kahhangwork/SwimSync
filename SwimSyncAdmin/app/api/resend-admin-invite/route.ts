import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/adminManagementGate";
import { sendCoAdminInviteEmail } from "@/lib/coAdminInviteEmail";

/**
 * The owner re-sends a co-admin's invite. Same refusal as the platform-level
 * resend-invite route: once the account has signed in it owns its password,
 * and a fresh invite link to a live account is a password-reset vector
 * wearing onboarding clothes.
 */
export async function POST(req: NextRequest) {
  const gate = await requireOwner(req);
  if (!gate.ok) return gate.response;
  const { tenantId, adminClient } = gate;

  const { profileId } = await req.json();
  if (!profileId) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  const { data: target } = await adminClient
    .from("profiles")
    .select("id, email, full_name, role, tenant_id")
    .eq("id", profileId)
    .maybeSingle();

  if (!target || target.role !== "tenant_admin" || target.tenant_id !== tenantId) {
    return NextResponse.json(
      { error: "Not an admin of your business" },
      { status: 404 }
    );
  }

  const { data: authUser } = await adminClient.auth.admin.getUserById(target.id);
  if (authUser?.user?.last_sign_in_at) {
    return NextResponse.json(
      {
        error:
          "That admin has already signed in. Ask them to use “Forgot password” instead — resending an invite to a live account is not a password reset.",
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
      email: target.email,
      options: { redirectTo: `${new URL(req.url).origin}/accept-invite` },
    });

  if (linkErr || !link?.properties?.action_link) {
    return NextResponse.json(
      { error: linkErr?.message ?? "Could not generate a fresh invite link" },
      { status: 500 }
    );
  }

  const sendResult = await sendCoAdminInviteEmail({
    apiKey: process.env.RESEND_API_KEY,
    to: target.email,
    adminName: target.full_name,
    businessName: tenant?.display_name ?? "your business",
    actionLink: link.properties.action_link,
  });

  return NextResponse.json({
    success: true,
    adminEmail: target.email,
    emailSent: sendResult.sent,
    emailReason: sendResult.reason ?? null,
    inviteLink: sendResult.sent ? null : link.properties.action_link,
  });
}
