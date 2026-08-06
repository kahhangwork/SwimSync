import { NextRequest, NextResponse } from "next/server";
import { requireOwner, isPureAdmin, BAN_FOREVER } from "@/lib/adminManagementGate";

/**
 * Deactivate a co-admin: the RPC suspends their admin authority (RLS-level,
 * instant), and for a PURE admin we additionally BAN the auth account so they
 * cannot sign in at all. An admin-who-coaches is never banned — the coach app
 * is still theirs; only the admin half is suspended.
 *
 * THE TWO HALVES ARE NOT ATOMIC (RISK 3 of the plan), and the design leans on
 * that being survivable rather than pretending it can't happen:
 *   - the RPC is IDEMPOTENT, so this route can be re-run safely;
 *   - the ban half ALWAYS runs, even when the RPC reports a no-op;
 *   - the ban is READ BACK, and a miss fails the request loudly, telling the
 *     owner to press Deactivate again — retry IS the recovery path.
 *
 * The RPC runs as the CALLER: under the service role its is_tenant_owner()
 * gate would evaluate against a superuser and always pass.
 */
export async function POST(req: NextRequest) {
  const gate = await requireOwner(req);
  if (!gate.ok) return gate.response;
  const { adminClient, callerClient } = gate;

  const { profileId } = await req.json();
  if (!profileId) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  const { error: rpcErr } = await callerClient.rpc("deactivate_admin", {
    p_profile_id: profileId,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  const pure = await isPureAdmin(adminClient, profileId);
  if (!pure) {
    return NextResponse.json({ success: true, banned: false });
  }

  const { error: banErr } = await adminClient.auth.admin.updateUserById(
    profileId,
    { ban_duration: BAN_FOREVER }
  );

  // Read back rather than trusting the call: a suspended-but-not-banned pure
  // admin keeps membership reads for a token lifetime, and the UI must not
  // report that state as done.
  const { data: after } = await adminClient.auth.admin.getUserById(profileId);
  const bannedUntil = (after?.user as { banned_until?: string } | undefined)
    ?.banned_until;
  const banStuck = !!bannedUntil && new Date(bannedUntil) > new Date();

  if (banErr || !banStuck) {
    return NextResponse.json(
      {
        error:
          "Admin access was suspended, but blocking their login failed — press Deactivate again to finish.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, banned: true });
}
