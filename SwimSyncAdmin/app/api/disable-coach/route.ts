import { NextRequest, NextResponse } from "next/server";
import { requireActiveAdmin, BAN_FOREVER } from "@/lib/adminManagementGate";

/**
 * Disable a coach: the RPC cuts their coach authority (RLS-level, instant —
 * and atomically hands their active classes to the replacement), and for a
 * PURE coach we additionally BAN the auth account so they cannot sign in at
 * all. An admin-who-coaches is never banned — the admin panel is still
 * theirs; only the coach half is disabled (WAVE_5_PLAN.md chunk 2).
 *
 * Gate: ANY active tenant admin, not owner-only (decision 7 — a coach is
 * "their own staffing"; the owner-lockout risk is closed by the RPC's
 * sole-coach guard, not here).
 *
 * THE TWO HALVES ARE NOT ATOMIC, same as deactivate-admin, and the same
 * contract makes that survivable: the RPC is idempotent, the ban half always
 * runs, the ban is READ BACK, and a miss fails loudly telling the admin to
 * press Disable again — retry IS the recovery path.
 *
 * The RPC runs as the CALLER: under the service role its is_tenant_admin()
 * gate would evaluate against a superuser and always pass (§7.8).
 */
export async function POST(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if (!gate.ok) return gate.response;
  const { adminClient, callerClient } = gate;

  const { coachId, replacementCoachId } = await req.json();
  if (!coachId) {
    return NextResponse.json({ error: "coachId is required" }, { status: 400 });
  }

  const { error: rpcErr } = await callerClient.rpc("disable_coach", {
    p_coach_id: coachId,
    p_replacement_coach_id: replacementCoachId ?? null,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  // The ban half — PURE coaches only. profiles.role decides: an
  // admin-who-coaches carries 'tenant_admin' and keeps their login. Two plain
  // queries, not an embedded join — a join whose shape surprises us here would
  // FAIL SILENTLY as "not pure", leaving a disabled coach's login alive.
  const { data: coach } = await adminClient
    .from("coaches")
    .select("profile_id")
    .eq("id", coachId)
    .single();
  const profileId = coach?.profile_id;
  if (!profileId) {
    return NextResponse.json({ success: true, banned: false });
  }
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", profileId)
    .single();
  if (profile?.role !== "coach") {
    return NextResponse.json({ success: true, banned: false });
  }

  const { error: banErr } = await adminClient.auth.admin.updateUserById(
    profileId,
    { ban_duration: BAN_FOREVER }
  );

  // Read back rather than trusting the call: a disabled-but-not-banned coach
  // keeps membership reads for a token lifetime, and the UI must not report
  // that state as done.
  const { data: after } = await adminClient.auth.admin.getUserById(profileId);
  const bannedUntil = (after?.user as { banned_until?: string } | undefined)
    ?.banned_until;
  const banStuck = !!bannedUntil && new Date(bannedUntil) > new Date();

  if (banErr || !banStuck) {
    return NextResponse.json(
      {
        error:
          "The coach was disabled, but blocking their login failed — press Disable again to finish.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, banned: true });
}
