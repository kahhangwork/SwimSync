import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";
import { BAN_FOREVER } from "@/lib/adminManagementGate";

/**
 * Suspend a business. Platform admin only (WAVE_5_PLAN.md chunk 3).
 *
 * The RPC cuts everything RLS-level and instantly: staff through
 * is_tenant_admin()/current_coach_id(), parents through the three parent
 * choke points and the direct policy arms. This route then BANS the tenant's
 * STAFF auth accounts — the enforcement for the accepted token-lifetime
 * residue (⚠ RISK 5). Parents are NEVER banned: they are multi-tenant, and a
 * parent in two businesses keeps the other (decision 5). The staff-shape
 * invariant (no profile holds both a parents row and a staff tenant_id —
 * pinned in coach_disable.test.sql) is what makes the role filter safe.
 *
 * THE TWO HALVES ARE NOT ATOMIC, same as deactivate-admin/disable-coach, and
 * the same contract makes that survivable: the RPC is idempotent, the ban
 * half always runs, every ban is READ BACK, and a miss fails loudly NAMING
 * the accounts still live — press Suspend again; retry IS the recovery path.
 *
 * The RPC runs as the CALLER: under the service role its is_platform_admin()
 * gate would evaluate against a superuser and always pass (§7.8).
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
      { error: "Only the platform admin may suspend a business" },
      { status: 403 }
    );
  }

  const { tenantId } = await req.json();
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const { error: rpcErr } = await callerClient.rpc("suspend_tenant", {
    p_tenant_id: tenantId,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  // The ban half — the tenant's STAFF, by profiles.role. Parents are absent
  // from this set by construction (their profiles carry no staff role), and
  // the individually-disabled are NOT skipped here: banning an already-dark
  // account is a harmless idempotent write, and the asymmetry lives in the
  // UNSUSPEND route, which must not resurrect them (⚠ RISK 3).
  const { data: staff, error: staffErr } = await adminClient
    .from("profiles")
    .select("id, email, role")
    .eq("tenant_id", tenantId)
    .in("role", ["tenant_admin", "coach"]);
  if (staffErr) {
    // A failed staff query must NOT read as "no staff to ban" — the tenant is
    // suspended (RLS-dark) but logins would stay alive past their tokens.
    return NextResponse.json(
      {
        error:
          "The business was suspended, but the staff list could not be read " +
          "so no logins were blocked — press Suspend again to finish.",
      },
      { status: 500 }
    );
  }

  const stillLive: string[] = [];
  for (const s of staff ?? []) {
    const { error: banErr } = await adminClient.auth.admin.updateUserById(
      s.id,
      { ban_duration: BAN_FOREVER }
    );
    // Read back rather than trusting the call — an unbanned staff account
    // keeps its token-lifetime reads, and the UI must not report that as done.
    const { data: after } = await adminClient.auth.admin.getUserById(s.id);
    const bannedUntil = (after?.user as { banned_until?: string } | undefined)
      ?.banned_until;
    const banStuck = !!bannedUntil && new Date(bannedUntil) > new Date();
    if (banErr || !banStuck) stillLive.push(s.email ?? s.id);
  }

  if (stillLive.length > 0) {
    return NextResponse.json(
      {
        error:
          `The business was suspended, but blocking these staff logins failed: ` +
          `${stillLive.join(", ")} — press Suspend again to finish.`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, banned: (staff ?? []).length });
}
