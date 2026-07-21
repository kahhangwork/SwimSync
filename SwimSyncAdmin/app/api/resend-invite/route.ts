import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";
import { sendInviteEmail } from "@/lib/inviteEmail";

/**
 * Re-send the set-your-password invite to a business's admin. Platform admin only.
 *
 * Exists because an invite that never arrives leaves a business LIVE and
 * JOINABLE with nobody able to operate it, and the remedy must not be
 * "provision it again" — that would mint a second business with a second join
 * code (the provision route returns 409 for exactly this reason).
 *
 * Refuses once the admin has actually signed in: at that point they own their
 * password and the correct route is the ordinary forgot-password flow. Sending a
 * fresh invite link to a live account would be a password-reset vector wearing
 * onboarding clothes.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";

  const callerClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: userData } = await callerClient.auth.getUser(token);
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "platform_admin") {
    return NextResponse.json(
      { error: "Only the platform admin may resend an invite" },
      { status: 403 }
    );
  }

  const { tenantId } = await req.json();
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const { data: tenant } = await adminClient
    .from("tenants")
    .select("id, display_name, join_code")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant) {
    return NextResponse.json({ error: "No such business" }, { status: 404 });
  }

  const { data: admin } = await adminClient
    .from("profiles")
    .select("id, email, full_name")
    .eq("tenant_id", tenantId)
    .eq("role", "tenant_admin")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!admin) {
    return NextResponse.json(
      {
        error:
          "This business has no admin account at all. It cannot be repaired by resending — create the admin, or remove the business.",
      },
      { status: 409 }
    );
  }

  // Has this account ever actually been used? A profiles row only proves an
  // invite was issued.
  const { data: authUser } = await adminClient.auth.admin.getUserById(admin.id);
  if (authUser?.user?.last_sign_in_at) {
    return NextResponse.json(
      {
        error:
          "That admin has already signed in. Ask them to use “Forgot password” instead — resending an invite to a live account is not a password reset.",
      },
      { status: 409 }
    );
  }

  const { data: link, error: linkErr } =
    await adminClient.auth.admin.generateLink({
      type: "invite",
      email: admin.email,
      options: { redirectTo: `${new URL(req.url).origin}/accept-invite` },
    });

  if (linkErr || !link?.properties?.action_link) {
    return NextResponse.json(
      { error: linkErr?.message ?? "Could not generate a fresh invite link" },
      { status: 500 }
    );
  }

  const actionLink = link.properties.action_link;
  const sendResult = await sendInviteEmail({
    apiKey: process.env.RESEND_API_KEY,
    to: admin.email,
    adminName: admin.full_name,
    businessName: tenant.display_name,
    actionLink,
    joinCode: tenant.join_code,
  });

  return NextResponse.json({
    success: true,
    adminEmail: admin.email,
    emailSent: sendResult.sent,
    emailReason: sendResult.reason ?? null,
    inviteLink: sendResult.sent ? null : actionLink,
  });
}
