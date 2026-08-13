import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";
import {
  suspensionUnbanSet,
  type StaffProfile,
} from "@/lib/suspensionUnbanSet";

/**
 * Unsuspend a business. Platform admin only (WAVE_5_PLAN.md chunk 3).
 *
 * ⚠ RISK 3 — THE PROHIBITION THIS ROUTE EXISTS AROUND: the unban set is
 * (staff of tenant) MINUS (individually disabled). A naive mirror of the
 * suspend route would permanently resurrect logins that deactivate-admin or
 * disable-coach killed: an admin with admin_disabled_at set, or a pure coach
 * whose coaches.disabled_at is set, stays BANNED through the unsuspend.
 * verify-tenant-suspension proves this in a real browser.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";

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
  if (profile?.role !== "platform_admin") {
    return NextResponse.json(
      { error: "Only the platform admin may unsuspend a business" },
      { status: 403 }
    );
  }

  const { tenantId } = await req.json();
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const { error: rpcErr } = await callerClient.rpc("unsuspend_tenant", {
    p_tenant_id: tenantId,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  // The unban set, ⚠ RISK 3: start from the staff, EXCLUDE the individually
  // disabled. Two plain queries, not an embedded join — a join whose shape
  // surprises us here would fail silently and resurrect a killed login
  // (the disable-coach route's lesson, found in ITS review).
  const { data: staff, error: staffErr } = await adminClient
    .from("profiles")
    .select("id, email, role, admin_disabled_at")
    .eq("tenant_id", tenantId)
    .in("role", ["tenant_admin", "coach"]);
  const { data: disabledCoaches, error: coachErr } = await adminClient
    .from("coaches")
    .select("profile_id")
    .eq("tenant_id", tenantId)
    .not("disabled_at", "is", null);
  if (staffErr || coachErr) {
    // ⚠ RISK 3: unbanning from an incomplete exclusion list could resurrect
    // a killed login. A failed read means DO NOTHING and say so.
    return NextResponse.json(
      {
        error:
          "The business was unsuspended, but the staff list could not be " +
          "read so no logins were restored — press Unsuspend again to finish.",
      },
      { status: 500 }
    );
  }

  const toUnban = suspensionUnbanSet(
    (staff ?? []) as StaffProfile[],
    (disabledCoaches ?? []).map((c) => c.profile_id as string)
  );

  const stillBanned: string[] = [];
  for (const s of toUnban) {
    const { error: unbanErr } = await adminClient.auth.admin.updateUserById(
      s.id,
      { ban_duration: "none" }
    );
    const { data: after } = await adminClient.auth.admin.getUserById(s.id);
    const bannedUntil = (after?.user as { banned_until?: string } | undefined)
      ?.banned_until;
    const banGone = !bannedUntil || new Date(bannedUntil) <= new Date();
    if (unbanErr || !banGone) stillBanned.push(s.email ?? s.id);
  }

  if (stillBanned.length > 0) {
    return NextResponse.json(
      {
        error:
          `The business was unsuspended, but restoring these staff logins ` +
          `failed: ${stillBanned.join(", ")} — press Unsuspend again to finish.`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    unbanned: toUnban.length,
    keptBanned: (staff ?? []).length - toUnban.length,
  });
}
