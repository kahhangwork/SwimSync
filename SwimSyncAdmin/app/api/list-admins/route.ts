import { NextRequest, NextResponse } from "next/server";
import { requireActiveAdmin } from "@/lib/adminManagementGate";

/**
 * The Admins page's data: every tenant_admin of the caller's business, with
 * the one field the browser cannot read — invited-vs-active, which lives in
 * auth.users.last_sign_in_at. Everything else (names, admin_disabled_at,
 * owner_profile_id) is client-readable under RLS; this route exists for the
 * auth-layer lookup, and returns the whole row set so the page has one source.
 *
 * Any ACTIVE admin of the tenant may look — seeing who runs the business is
 * not a privilege. Mutating anything is (see the owner-gated routes).
 */
export async function GET(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if (!gate.ok) return gate.response;
  const { tenantId, ownerProfileId, isOwner, adminClient } = gate;

  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id, full_name, email, phone, admin_disabled_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("role", "tenant_admin")
    .order("created_at");

  const { data: coachRows } = await adminClient
    .from("coaches")
    .select("profile_id")
    .in("profile_id", (profiles ?? []).map((p) => p.id));
  const coachIds = new Set((coachRows ?? []).map((c) => c.profile_id));

  const admins = await Promise.all(
    (profiles ?? []).map(async (p) => {
      const { data: authUser } = await adminClient.auth.admin.getUserById(p.id);
      const status = p.admin_disabled_at
        ? "deactivated"
        : authUser?.user?.last_sign_in_at
          ? "active"
          : "invited";
      return {
        id: p.id,
        fullName: p.full_name,
        email: p.email,
        phone: p.phone,
        isOwner: p.id === ownerProfileId,
        isCoach: coachIds.has(p.id),
        status,
      };
    })
  );

  return NextResponse.json({ admins, callerIsOwner: isOwner });
}
