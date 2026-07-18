import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";

// Manual, on-demand invoice generation triggered from the admin panel.
// Verifies the caller administers a tenant, then invokes the generate-invoices
// Edge Function server-side (so the CRON_SECRET is never exposed to the
// browser). Runs the function in "manual" mode for a chosen month.
//
// `force` is deliberately NOT sent. It used to be hardcoded true, which meant
// the engine's attendance-completeness gate never fired on the only path that
// actually runs — so a forgotten lesson was billed around silently. The gate
// now blocks generation until every lesson is marked (or marked cancelled).
// `force` retains its other meaning, skipping the sealed-month guard, which is
// the documented reopen path and not something this button should do.
export async function POST(req: NextRequest) {
  // ── Verify caller is an authenticated superadmin ──────────────────────────
  const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const callerClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: userData } = await callerClient.auth.getUser(token);
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", userData.user.id)
    .single();

  // A TENANT admin bills their own business. The PLATFORM admin has no tenant
  // of their own, so they must name one — billing "everything" from a support
  // account is not a button anyone should have.
  const isTenantAdmin = profile?.role === "tenant_admin";
  const isPlatformAdmin = profile?.role === "platform_admin";
  if (!isTenantAdmin && !isPlatformAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse + validate billing month ────────────────────────────────────────
  const body = await req.json();
  const billing_month = body?.billing_month;
  if (!billing_month || !/^\d{4}-\d{2}$/.test(billing_month)) {
    return NextResponse.json(
      { error: "billing_month must be in YYYY-MM format" },
      { status: 400 }
    );
  }

  // ── Resolve the tenant to bill ────────────────────────────────────────────
  // NEVER taken from the request for a tenant admin: it comes from their own
  // profile, so a crafted body cannot make one business bill another's
  // families. The engine runs as service_role and bypasses RLS, so this is the
  // only thing standing between the two.
  const tenantId = isTenantAdmin ? profile!.tenant_id : body?.tenant_id;
  if (!tenantId) {
    return NextResponse.json(
      {
        error: isPlatformAdmin
          ? "tenant_id is required — a platform admin must name the business to bill"
          : "Your account is not attached to a business",
      },
      { status: 400 }
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 }
    );
  }

  // ── Invoke the Edge Function (same code path as the cron) ─────────────────
  const functionsUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-invoices`;
  let fnRes: Response;
  try {
    fnRes = await fetch(functionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "manual", billing_month, tenant_id: tenantId }),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Could not reach the generate-invoices function. Is it running? " +
          "Locally: `supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt`",
        detail: String(e),
      },
      { status: 502 }
    );
  }

  const result = await fnRes.json().catch(() => ({}));
  if (!fnRes.ok) {
    return NextResponse.json(
      { error: "Function returned an error", detail: result },
      { status: 502 }
    );
  }

  return NextResponse.json(result);
}
