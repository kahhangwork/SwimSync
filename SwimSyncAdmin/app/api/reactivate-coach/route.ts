import { NextRequest, NextResponse } from "next/server";
import { requireActiveAdmin } from "@/lib/adminManagementGate";

/**
 * Reactivate a disabled coach: clear the disable (idempotent RPC, as the
 * caller — it takes no refusals beyond the gate and does NOT hand classes
 * back) and lift the login ban a pure coach got on disabling. Same
 * retry-is-recovery contract as disable-coach: the unban half always runs and
 * is read back, so a half-applied pair is finished by pressing the button
 * again.
 */
export async function POST(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if (!gate.ok) return gate.response;
  const { adminClient, callerClient } = gate;

  const { coachId } = await req.json();
  if (!coachId) {
    return NextResponse.json({ error: "coachId is required" }, { status: 400 });
  }

  const { error: rpcErr } = await callerClient.rpc("reactivate_coach", {
    p_coach_id: coachId,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  // Same two plain queries as disable-coach, for the same reason: an embedded
  // join whose shape surprises us would fail silently as "not pure" and leave
  // the ban in place after a reactivation.
  const { data: coach } = await adminClient
    .from("coaches")
    .select("profile_id")
    .eq("id", coachId)
    .single();
  const profileId = coach?.profile_id;
  const { data: profile } = profileId
    ? await adminClient.from("profiles").select("role").eq("id", profileId).single()
    : { data: null };

  if (profileId && profile?.role === "coach") {
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
            "The coach was reactivated, but their login is still blocked — press Reactivate again to finish.",
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
