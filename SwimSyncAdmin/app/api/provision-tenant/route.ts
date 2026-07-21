import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";
import { sendInviteEmail } from "@/lib/inviteEmail";

/**
 * Provision a new business and invite its first admin. Platform admin only.
 *
 * TWO WRITES THAT CANNOT SHARE A TRANSACTION. The auth trigger
 * (handle_new_user) refuses to create a tenant_admin without an existing
 * tenant_id rather than guessing which business they belong to — so the tenant
 * must be COMMITTED before the auth user is created. The window between them has
 * a genuinely bad intermediate state: a business that is live and JOINABLE (its
 * join code works) with nobody able to administer it. A parent could join it and
 * their children would land in a business no one operates.
 *
 * So step 3 is wrapped and step 5 COMPENSATES by deleting the tenant. The
 * platform overview's admin_status = 'none' is the backstop for any orphan that
 * still escapes.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";

  // The caller's own client. Used for BOTH the identity check and the RPC.
  const callerClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
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

  // Only the platform admin. A TENANT admin runs one business and has no
  // authority to create another — and there is nothing to scope such a
  // permission to, since the tenant does not exist yet.
  if (profile?.role !== "platform_admin") {
    return NextResponse.json(
      { error: "Only the platform admin may create a business" },
      { status: 403 }
    );
  }

  const { businessName, kind, adminName, adminEmail, isCoach } =
    await req.json();

  if (!businessName?.trim() || !adminName?.trim() || !adminEmail?.trim()) {
    return NextResponse.json(
      { error: "businessName, adminName and adminEmail are required" },
      { status: 400 }
    );
  }
  if (kind && kind !== "private" && kind !== "school") {
    return NextResponse.json({ error: "kind must be private or school" }, { status: 400 });
  }

  const email = String(adminEmail).trim().toLowerCase();

  // ── Re-invite rather than duplicate ────────────────────────────────────────
  // "The invite didn't arrive, let me try again" must NOT silently produce a
  // second business with a second join code. If this email already administers a
  // tenant, hand off to the resend path instead of provisioning.
  const { data: existing } = await adminClient
    .from("profiles")
    .select("id, tenant_id, role")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.role === "tenant_admin"
            ? "That email already administers a business. Use Resend invite on its row instead of creating a new one."
            : "That email is already in use by another SwimSync account.",
        existingTenantId: existing.tenant_id ?? null,
      },
      { status: 409 }
    );
  }

  // ── 1. Create the tenant, AS THE CALLER ───────────────────────────────────
  // DO NOT switch this to adminClient. provision_tenant() is SECURITY DEFINER
  // and its is_platform_admin() gate is the entire boundary; called with the
  // service role that gate evaluates against a superuser and ALWAYS PASSES —
  // the check would exist and never fire. A safety gate that the only live
  // caller bypasses is not a gate.
  const { data: provRaw, error: provErr } = await callerClient
    .rpc("provision_tenant", {
      p_display_name: businessName.trim(),
      p_kind: kind ?? "private",
    })
    .select()
    .single();

  const provisioned = provRaw as {
    tenant_id: string;
    slug: string;
    join_code: string;
  } | null;

  if (provErr || !provisioned) {
    return NextResponse.json(
      { error: provErr?.message ?? "Could not create the business" },
      { status: 500 }
    );
  }

  const tenantId = provisioned.tenant_id;
  const joinCode = provisioned.join_code;

  // ── 2. Invite the admin; compensate on ANY failure ────────────────────────
  try {
    const { data: link, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "invite",
        email,
        options: {
          // The auth trigger reads these to build profiles + (if isCoach) the
          // coaches row. is_coach is the private-coach-as-tenant-of-one shape:
          // they administer the business AND teach in it. It is deliberately
          // independent of `kind` — a school's owner may well teach.
          data: {
            role: "tenant_admin",
            full_name: adminName.trim(),
            tenant_id: tenantId,
            is_coach: Boolean(isCoach),
          },
          redirectTo: `${new URL(req.url).origin}/accept-invite`,
        },
      });

    if (linkErr || !link?.properties?.action_link) {
      throw new Error(linkErr?.message ?? "Could not generate an invite link");
    }

    const actionLink = link.properties.action_link;

    const sendResult = await sendInviteEmail({
      apiKey: process.env.RESEND_API_KEY,
      to: email,
      adminName: adminName.trim(),
      businessName: businessName.trim(),
      actionLink,
      joinCode,
    });

    // Unlike an invoice email, a missing invite means the owner has NO way in.
    // Return the link so the operator can pass it on by hand, and let the UI
    // show that as a warning — never a plain success.
    return NextResponse.json({
      success: true,
      tenantId,
      joinCode,
      slug: provisioned.slug,
      adminEmail: email,
      emailSent: sendResult.sent,
      emailReason: sendResult.reason ?? null,
      inviteLink: sendResult.sent ? null : actionLink,
    });
  } catch (e) {
    // COMPENSATE. Without this the tenant survives with a live join code and no
    // operator. Delete is safe here and only here: the tenant was created
    // seconds ago by this request and cannot yet have families, classes or
    // billing hanging off it.
    await adminClient.from("tenants").delete().eq("id", tenantId);
    return NextResponse.json(
      {
        error: `Could not invite the admin, so the business was not created: ${
          (e as Error).message
        }`,
      },
      { status: 500 }
    );
  }
}
