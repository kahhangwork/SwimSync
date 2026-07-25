import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";
import { sendParentInviteEmail } from "@/lib/parentInviteEmail";

/**
 * Invite the parent of an unclaimed child — one a coach put on the roster
 * before the family had an account. The business's own admin only.
 *
 * THE HAPPY PATH FOR CLAIMING. Unlike parent self-registration (slice 2) there
 * is no matching to get wrong and no candidate list to leak: the admin asserts
 * the link, so the parent lands with this child already attached and every
 * lesson already marked for them becomes billable.
 *
 * ORDER MATTERS AND CANNOT BE TRANSACTIONAL. The auth user must exist before
 * `parents` does (handle_new_user creates it), and the links need parents.id.
 * So: create user → link. If linking fails the auth user is deleted, because a
 * parent account that exists but holds nothing is worse than no account —
 * they would get an invite email, set a password, and find an empty app with
 * no way to reach their child. Same compensation reasoning as
 * /api/provision-tenant.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";

  // The caller's own client — used for the identity check AND the linking RPC.
  const callerClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData } = await callerClient.auth.getUser(token);
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { student_id, email: rawEmail } = await req.json();
  if (!student_id || !rawEmail?.trim()) {
    return NextResponse.json(
      { error: "student_id and email are required" },
      { status: 400 }
    );
  }
  const email = String(rawEmail).trim().toLowerCase();

  const adminClient = createAdminClient();

  // Resolve the child and the business they belong to. Read with the SERVICE
  // role deliberately: the authorisation decision is made by
  // link_invited_parent()'s own is_tenant_admin() gate, called as the caller
  // below. Using RLS here as well would be a second, weaker copy of that rule.
  const { data: student } = await adminClient
    .from("students")
    .select("id, full_name, tenant_id, tenants(display_name)")
    .eq("id", student_id)
    .maybeSingle();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const businessName =
    (student.tenants as { display_name?: string } | null)?.display_name ??
    "Your coach";

  // How many lessons are already on record, so the email can set the
  // expectation that a first invoice may cover lessons already taught.
  const { count: lessonsRecorded } = await adminClient
    .from("attendance")
    .select("id", { count: "exact", head: true })
    .eq("student_id", student_id)
    .in("status", ["present", "trial_paid"]);

  // ── An account may already exist ──────────────────────────────────────────
  // A parent with one registered child whose SECOND child was added as a
  // walk-in. There is nothing to invite — they already have a password — so
  // link the child and tell the admin that is what happened. Sending an invite
  // here would fail on the duplicate email and read as a broken feature.
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    if (existingProfile.role !== "parent") {
      return NextResponse.json(
        { error: "That email belongs to a coach or admin account, not a parent." },
        { status: 409 }
      );
    }
    const { error: linkErr } = await callerClient.rpc("link_invited_parent", {
      p_profile_id: existingProfile.id,
      p_student_id: student_id,
    });
    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      emailed: true,
      alreadyRegistered: true,
      message: `${email} already has a SwimSync account — ${student.full_name} has been added to it.`,
    });
  }

  // ── Create the account, then link; compensate on failure ──────────────────
  const { data: link, error: linkGenErr } =
    await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        // role=parent is what makes handle_new_user create profiles + parents.
        // It deliberately does NOT create parent_tenants — parents are global
        // and normally join by code — which is exactly what the RPC below adds.
        data: { role: "parent", full_name: "" },
        // ⚠ §7.41: this URL must be listed EXACTLY in
        // [auth].additional_redirect_urls. An unlisted redirect is not
        // rejected — site_url is silently substituted — so the link works and
        // lands on the ADMIN panel instead of the parent app.
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:8081"}/accept-invite`,
      },
    });

  if (linkGenErr || !link?.user?.id || !link?.properties?.action_link) {
    return NextResponse.json(
      { error: linkGenErr?.message ?? "Could not generate an invite link" },
      { status: 500 }
    );
  }

  const newUserId = link.user.id;

  const { error: rpcErr } = await callerClient.rpc("link_invited_parent", {
    p_profile_id: newUserId,
    p_student_id: student_id,
  });

  if (rpcErr) {
    // COMPENSATE: without this they get an invite to an account holding nothing.
    await adminClient.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      { error: `Could not link the child, so no invite was sent: ${rpcErr.message}` },
      { status: 400 }
    );
  }

  const actionLink = link.properties.action_link;

  const sendResult = await sendParentInviteEmail({
    apiKey: process.env.RESEND_API_KEY,
    to: email,
    businessName,
    studentName: student.full_name,
    actionLink,
    lessonsRecorded: lessonsRecorded ?? 0,
  });

  // The account and links are real either way — the child IS claimed now. Only
  // delivery is in doubt, so return the link rather than unwinding, and let the
  // UI present it as a warning rather than a plain success.
  return NextResponse.json({
    success: true,
    emailed: sendResult.sent,
    emailReason: sendResult.reason ?? null,
    invite_link: sendResult.sent ? null : actionLink,
  });
}
