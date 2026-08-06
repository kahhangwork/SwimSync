import { NextRequest, NextResponse } from "next/server";
import { requireOwner, isPureAdmin, BAN_FOREVER } from "@/lib/adminManagementGate";

/**
 * Hard-delete a PURE co-admin (an admin-who-coaches is demoted via the
 * remove_admin_role RPC instead, straight from the browser — never here).
 *
 * ORDER IS LOAD-BEARING (RISK 6 of the plan): ban → RPC → deleteUser.
 * The RPC purges the target's audit_log rows (the step the typed-DELETE modal
 * warned about) before the auth user is deleted; banning FIRST closes the
 * window in which the target could write fresh audit rows between the purge
 * and the cascade — those would make the profiles cascade fail on the
 * actor_id FK after the history was already gone.
 *
 * If the RPC refuses (recorded activity, coach row, not-an-admin …), the ban
 * is COMPENSATED so a refused delete does not leave a working admin locked
 * out. If deleteUser itself fails, the account stays banned and the owner is
 * told to press Delete again — the RPC's second run finds nothing left to
 * purge and succeeds as a no-op-shaped pass through its checks.
 */
export async function POST(req: NextRequest) {
  const gate = await requireOwner(req);
  if (!gate.ok) return gate.response;
  const { adminClient, callerClient } = gate;

  const { profileId } = await req.json();
  if (!profileId) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  // The RPC re-checks this, but banning a coach-admin even transiently would
  // cut their coach app access — refuse the wrong kind before touching auth.
  if (!(await isPureAdmin(adminClient, profileId))) {
    return NextResponse.json(
      {
        error:
          "This admin is also a coach — remove their admin role instead of deleting the account.",
      },
      { status: 400 }
    );
  }

  // 1. Ban — no new sessions from here on.
  const { error: banErr } = await adminClient.auth.admin.updateUserById(
    profileId,
    { ban_duration: BAN_FOREVER }
  );
  if (banErr) {
    return NextResponse.json(
      { error: `Could not lock the account before deleting: ${banErr.message}` },
      { status: 500 }
    );
  }

  // 2. The database half, AS THE CALLER (the owner gate lives inside it).
  const { error: rpcErr } = await callerClient.rpc("prepare_admin_delete", {
    p_profile_id: profileId,
  });
  if (rpcErr) {
    // Compensate: a refused delete must not leave a working admin banned.
    await adminClient.auth.admin.updateUserById(profileId, {
      ban_duration: "none",
    });
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  // 3. The auth user; auth.users → profiles cascades.
  const { error: delErr } = await adminClient.auth.admin.deleteUser(profileId);
  if (delErr) {
    return NextResponse.json(
      {
        error:
          "The account is locked but not yet deleted — press Delete again to finish.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
