import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * The shared gate for the admin-management routes (invite / resend /
 * deactivate / reactivate / delete / list). Five routes need the identical
 * opening — bearer token → caller identity → caller profile → tenant — and a
 * gate this security-relevant should exist once, not five slightly-different
 * times.
 *
 * Two levels:
 *   requireActiveAdmin — any ACTIVE tenant_admin of a business (list-admins).
 *   requireOwner       — the tenant's owner_profile_id holder (everything
 *                        that mutates).
 *
 * The caller's tenant always comes from THEIR OWN profile, never the request
 * body (create-coach's rule). callerClient carries the caller's Authorization
 * header so RPCs run AS THE CALLER — called with the service role, the
 * is_tenant_owner() gate inside each RPC evaluates against a superuser and
 * always passes (provision-tenant's warning; §7.8).
 */

export type GateResult =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      callerId: string;
      tenantId: string;
      ownerProfileId: string | null;
      isOwner: boolean;
      adminClient: SupabaseClient;
      callerClient: SupabaseClient;
    };

async function gate(req: NextRequest): Promise<GateResult> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";

  const callerClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData } = await callerClient.auth.getUser(token);
  if (!userData.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role, tenant_id, admin_disabled_at")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "tenant_admin" || !profile.tenant_id) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            profile?.role === "platform_admin"
              ? "A platform admin belongs to no business — only a business's own admin can manage its admin accounts."
              : "Forbidden",
        },
        { status: 403 }
      ),
    };
  }

  if (profile.admin_disabled_at) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your admin access has been suspended." },
        { status: 403 }
      ),
    };
  }

  const { data: tenant } = await adminClient
    .from("tenants")
    .select("owner_profile_id")
    .eq("id", profile.tenant_id)
    .single();

  return {
    ok: true,
    callerId: userData.user.id,
    tenantId: profile.tenant_id,
    ownerProfileId: tenant?.owner_profile_id ?? null,
    isOwner: tenant?.owner_profile_id === userData.user.id,
    adminClient,
    callerClient,
  };
}

export async function requireActiveAdmin(req: NextRequest): Promise<GateResult> {
  return gate(req);
}

export async function requireOwner(req: NextRequest): Promise<GateResult> {
  const result = await gate(req);
  if (!result.ok) return result;
  if (!result.isOwner) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only the business owner may manage admin accounts." },
        { status: 403 }
      ),
    };
  }
  return result;
}

/** ~100 years. Supabase has no permanent ban flag; this is the idiom. */
export const BAN_FOREVER = "876000h";

/** Is this profile a PURE admin (no coaches row)? Pure admins are the only
 *  ones banned on deactivation and the only ones hard-deletable. */
export async function isPureAdmin(
  adminClient: SupabaseClient,
  profileId: string
): Promise<boolean> {
  const { data } = await adminClient
    .from("coaches")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  return !data;
}
