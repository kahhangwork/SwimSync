import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";

// Manual, on-demand invoice generation triggered from the admin panel.
// Verifies the caller is a superadmin, then invokes the generate-invoices
// Edge Function server-side (so the CRON_SECRET is never exposed to the
// browser). Runs the function in "manual" + force mode for a chosen month.
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
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse + validate billing month ────────────────────────────────────────
  const { billing_month } = await req.json();
  if (!billing_month || !/^\d{4}-\d{2}$/.test(billing_month)) {
    return NextResponse.json(
      { error: "billing_month must be in YYYY-MM format" },
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
      body: JSON.stringify({ mode: "manual", force: true, billing_month }),
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
