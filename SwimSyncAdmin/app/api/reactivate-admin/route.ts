import { NextRequest, NextResponse } from "next/server";
import { requireOwner, isPureAdmin } from "@/lib/adminManagementGate";

/**
 * Reactivate a deactivated co-admin: clear the suspension (idempotent RPC, as
 * the caller) and lift the login ban a pure admin got on deactivation. Same
 * retry-is-recovery contract as deactivate-admin: the unban half always runs
 * and is read back, so a half-applied pair is finished by pressing the button
 * again.
 */
export async function POST(req: NextRequest) {
  const gate = await requireOwner(req);
  if (!gate.ok) return gate.response;
  const { adminClient, callerClient } = gate;

  const { profileId } = await req.json();
  if (!profileId) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  const { error: rpcErr } = await callerClient.rpc("reactivate_admin", {
    p_profile_id: profileId,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  if (await isPureAdmin(adminClient, profileId)) {
    const { error: unbanErr } = await adminClient.auth.admin.updateUserById(
      profileId,
      { ban_duration: "none" }
    );

    const { data: after } = await adminClient.auth.admin.getUserById(profileId);
    const bannedUntil = (after?.user as { banned_until?: string } | undefined)
      ?.banned_until;
    const stillBanned = !!bannedUntil && new Date(bannedUntil) > new Date();

    if (unbanErr || stillBanned) {
      return NextResponse.json(
        {
          error:
            "Admin access was restored, but their login is still blocked — press Reactivate again to finish.",
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
