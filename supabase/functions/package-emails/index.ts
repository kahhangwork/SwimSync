// package-emails — best-effort purchase notifications, caller-authorized.
//
// POST { type: "requested" | "confirmed", package_id: UUID }
//
// WHY AN EDGE FUNCTION AND NOT THE CLIENTS: the Resend key must never ship in
// a client bundle, and the two callers are different apps (the parent's
// mobile app on request, the admin panel on confirm). One function serves
// both, keyed by the SAME project-level RESEND_API_KEY secret the invoice
// emails already use — no new secret surface anywhere.
//
// AUTHORIZATION: verify_jwt is ON (unlike generate-invoices, which is
// cron-secret gated), so Supabase has already validated the caller's JWT.
// The body then re-checks the caller against the package with a service
// client:
//   • "requested"  — caller must BE the package's parent, and it is pending.
//   • "confirmed"  — caller must ADMIN the package's tenant, and it is active.
// The service client bypasses RLS, so these checks are the whole boundary.
//
// Best-effort by contract: every failure returns 200 with {sent:false} —
// a purchase or confirmation must never look failed because an email was.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildConfirmedHtml,
  buildConfirmedSubject,
  buildRequestedHtml,
  buildRequestedSubject,
  sendPackageEmail,
  type PackageEmailData,
} from "./email.ts";

Deno.serve(async (req) => {
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const { type, package_id } = await req.json().catch(() => ({}));
    if (
      (type !== "requested" && type !== "confirmed") ||
      typeof package_id !== "string"
    ) {
      return respond({ sent: false, reason: "bad request" }, 400);
    }

    // Who is calling? The JWT is already verified by the platform; this
    // resolves it to a user id.
    const authHeader = req.headers.get("Authorization") ?? "";
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userRes } = await anon.auth.getUser();
    const caller = userRes?.user;
    if (!caller) return respond({ sent: false, reason: "unauthorized" }, 401);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: pkg } = await svc
      .from("parent_packages")
      .select(
        "id, status, name, lesson_count, rate_per_lesson, total_value, expires_on, tenant_id, parents(profile_id, profiles(full_name, email)), tenants(display_name, logo_url)"
      )
      .eq("id", package_id)
      .maybeSingle();
    if (!pkg) return respond({ sent: false, reason: "not found" }, 404);

    const parent: any = Array.isArray(pkg.parents) ? pkg.parents[0] : pkg.parents;
    const tenant: any = Array.isArray(pkg.tenants) ? pkg.tenants[0] : pkg.tenants;
    const parentProfile: any = Array.isArray(parent?.profiles)
      ? parent?.profiles?.[0]
      : parent?.profiles;

    if (type === "requested") {
      if (parent?.profile_id !== caller.id || pkg.status !== "pending") {
        return respond({ sent: false, reason: "not allowed" }, 403);
      }
    } else {
      // Confirm email: only the business's own admin. Same tenant_id
      // question the admin panel gates on — never the role enum (§7.19).
      const { data: callerProfile } = await svc
        .from("profiles")
        .select("tenant_id")
        .eq("id", caller.id)
        .maybeSingle();
      if (
        callerProfile?.tenant_id !== pkg.tenant_id ||
        pkg.status !== "active"
      ) {
        return respond({ sent: false, reason: "not allowed" }, 403);
      }
    }

    const data: PackageEmailData = {
      parentName: parentProfile?.full_name ?? "there",
      businessName: tenant?.display_name ?? "Your coach",
      logoUrl: tenant?.logo_url ?? null,
      packageName: pkg.name as string,
      lessonCount: Number(pkg.lesson_count),
      ratePerLesson: Number(pkg.rate_per_lesson),
      totalValue: Number(pkg.total_value),
      expiresOn: (pkg.expires_on as string | null) ?? null,
    };

    const result = await sendPackageEmail({
      apiKey: Deno.env.get("RESEND_API_KEY"),
      to: parentProfile?.email as string | undefined,
      subject:
        type === "requested"
          ? buildRequestedSubject(data)
          : buildConfirmedSubject(data),
      html:
        type === "requested"
          ? buildRequestedHtml(data)
          : buildConfirmedHtml(data),
      fromName: data.businessName,
    });

    if (!result.sent) console.log(`package email not sent: ${result.reason}`);
    return respond(result);
  } catch (e) {
    console.log(`package-emails error: ${(e as Error).message}`);
    return respond({ sent: false, reason: "internal" });
  }
});
