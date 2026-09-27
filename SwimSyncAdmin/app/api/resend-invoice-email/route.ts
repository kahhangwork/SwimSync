import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";

// Re-send ONE invoice email, from the Billing months card's "may not have
// arrived" list (docs/plans/CRASH_SAFE_EMAIL_CLAIM_PLAN.md §2, §3.2).
//
// The email code lives in the generate-invoices Edge Function, which only
// accepts CRON_SECRET — so, like /api/generate-invoices, this route authorises
// the caller and then invokes it server-side, never exposing the secret. The
// function bills nothing on this path; it claims, sends and settles one email.
//
// AUTHORITY: has_admin_area(<the invoice's tenant>, 'billing', 'edit'),
// evaluated AS THE CALLER (their JWT) — under the service role it would run
// against a superuser and always pass (§7.8). Like is_tenant_admin before it
// (re-pointed by Roles, the lane that landed second), it is false for a
// platform admin — who must not send mail in a business's name (the
// credit-note Resend's ⚠ RISK 4) — a suspended business and a disabled admin.
//
// A human resend of an email whose outcome is unknown after 24 h
// (MAY_HAVE_SENT) is a choice to risk one duplicate. It goes out under the
// invoice's one Idempotency-Key, which has lapsed by then, so Resend sends it
// fresh. The function handles that; nothing here does.
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: userData } = await anonClient.auth.getUser(token);
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const invoiceId = body?.invoice_id;
  if (typeof invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(invoiceId)) {
    return NextResponse.json({ error: "invoice_id is required" }, { status: 400 });
  }

  // The tenant comes from the INVOICE, read with the service role — never from
  // the request. The engine runs as service_role, so this check is the boundary.
  const { data: invoice } = await createAdminClient()
    .from("invoices")
    .select("tenant_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice?.tenant_id) {
    return NextResponse.json({ error: "No such invoice" }, { status: 404 });
  }

  const callerClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  // Roles (20260927000500): Billing: Edit, not merely "an admin". Like
  // is_tenant_admin before it, has_admin_area is false for a platform admin.
  const { data: isTenantAdmin } = await callerClient.rpc("has_admin_area", {
    p_tenant: invoice.tenant_id,
    p_area: "billing",
    p_level: "edit",
  });
  if (isTenantAdmin !== true) {
    return NextResponse.json(
      { error: "Only this business's admin can resend its invoice emails" },
      { status: 403 }
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 }
    );
  }

  let fnRes: Response;
  try {
    fnRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-invoices`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cronSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ resend_invoice_email: invoiceId }),
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "Could not reach the generate-invoices function", detail: String(e) },
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
  // { sent: true } or { sent: false, reason } — a failed send is not an HTTP
  // error; the card shows the reason inline.
  return NextResponse.json(result);
}
