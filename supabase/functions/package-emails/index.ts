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

import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../_shared/database.overrides.ts";
import type { CallerDb, ServiceDb } from "../_shared/clientBrands.ts";
import * as repo from "./dao/packageEmails.repo.ts";
import { getCallerUser } from "./dao/packageEmails.rpc.ts";
import { packagesAdmin } from "./domain/packagesAdmin.ts";
import {
  authorizePackageEmail,
  buildReferralRewardHtml,
  buildReferralRewardSubject,
  sendPackageEmail,
} from "./domain/email.ts";
import {
  packageEmailContent,
  packageEmailData,
  packageEmailParties,
  referralRewardEmail,
} from "./domain/packageEmailMapping.ts";

// packagesAdmin (the caller's packages:edit check): domain/packagesAdmin.ts (B11).

const APP_URL = Deno.env.get("APP_URL") ?? "https://swimsync.sg";

Deno.serve(async (req) => {
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const { type, package_id, reward_id } = body;
    if (
      (type !== "requested" && type !== "confirmed" && type !== "offered" &&
        type !== "referral_reward") ||
      (type === "referral_reward"
        ? typeof reward_id !== "string"
        : typeof package_id !== "string")
    ) {
      return respond({ sent: false, reason: "bad request" }, 400);
    }

    // Who is calling? The JWT is already verified by the platform; this
    // resolves it to a user id.
    const authHeader = req.headers.get("Authorization") ?? "";
    const anon = createClient<Database>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    ) as CallerDb;
    const { data: userRes } = await getCallerUser(anon);
    const caller = userRes?.user;
    if (!caller) return respond({ sent: false, reason: "unauthorized" }, 401);

    const svc = createClient<Database>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    ) as ServiceDb;

    // ── referral_reward — its OWN recipient path (RISK 3). The recipient is the
    // REFERRER (the reward's own parent), never a package's parent; the data
    // carries no field from the referee's package. Caller must admin the
    // reward's tenant.
    if (type === "referral_reward") {
      const { data: reward } = await repo.readReferralReward(svc, reward_id);
      if (!reward) return respond({ sent: false, reason: "not found" }, 404);

      const isAdmin = await packagesAdmin(anon, reward.tenant_id as string);
      if (
        !authorizePackageEmail(
          "referral_reward",
          { status: "", offeredBy: null, parentProfileId: null,
            tenantId: reward.tenant_id as string },
          { id: caller.id, isAdminOfTenant: isAdmin === true, profileTenantId: null },
        )
      ) {
        return respond({ sent: false, reason: "not allowed" }, 403);
      }

      // Recipient + data: domain/packageEmailMapping.ts (B11).
      const { to: rTo, data: rData } = referralRewardEmail(reward);
      const result = await sendPackageEmail({
        apiKey: Deno.env.get("RESEND_API_KEY"),
        to: rTo,
        subject: buildReferralRewardSubject(rData),
        html: buildReferralRewardHtml(rData),
        fromName: rData.businessName,
      });
      if (!result.sent) console.log(`referral reward email not sent: ${result.reason}`);
      return respond(result);
    }

    const { data: pkg } = await repo.readPackage(svc, package_id);
    if (!pkg) return respond({ sent: false, reason: "not found" }, 404);

    // Normalised embeds + recipient: domain/packageEmailMapping.ts (B11).
    const { parent, tenant, parentProfile, to } = packageEmailParties(pkg);

    // Gather the authz inputs, then let the pure decider rule (RISK 6). Only
    // the input each type needs is fetched: the can_admin_tenant RPC (as the
    // CALLER, via their own JWT) for an offer; the caller's home tenant for a
    // confirm.
    let isAdminOfTenant = false;
    let profileTenantId: string | null = null;
    if (type === "offered") {
      const isAdmin = await packagesAdmin(anon, pkg.tenant_id as string);
      isAdminOfTenant = isAdmin === true;
    } else if (type === "confirmed") {
      const { data: callerProfile } = await repo.readCallerTenant(svc, caller);
      profileTenantId = callerProfile?.tenant_id ?? null;
    }
    if (
      !authorizePackageEmail(
        type,
        {
          status: pkg.status as string,
          offeredBy: (pkg.offered_by as string | null) ?? null,
          parentProfileId: parent?.profile_id ?? null,
          tenantId: pkg.tenant_id as string,
        },
        { id: caller.id, isAdminOfTenant, profileTenantId },
      )
    ) {
      return respond({ sent: false, reason: "not allowed" }, 403);
    }

    const data = packageEmailData(pkg, parentProfile, tenant, APP_URL);
    const { subject, html } = packageEmailContent(type, data);

    const result = await sendPackageEmail({
      apiKey: Deno.env.get("RESEND_API_KEY"),
      to,
      subject,
      html,
      fromName: data.businessName,
    });

    if (!result.sent) console.log(`package email not sent: ${result.reason}`);
    return respond(result);
  } catch (e) {
    console.log(`package-emails error: ${(e as Error).message}`);
    return respond({ sent: false, reason: "internal" });
  }
});
