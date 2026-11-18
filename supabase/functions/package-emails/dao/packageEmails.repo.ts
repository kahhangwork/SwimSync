// package-emails' table reads, moved verbatim out of index.ts
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B11). All three use the SERVICE client — the
// authorisation that guards them is the caller's (dao/packageEmails.rpc.ts).

import type { ServiceDb } from "../../_shared/clientBrands.ts";

export function readReferralReward(svc: ServiceDb, reward_id: string) {
  return svc
        .from("referral_rewards")
        // ONE string literal, never `+`-joined: a concatenation widens to `string`,
        // supabase-js can no longer parse the column list, and the row is typed
        // GenericStringError — every field access below fails `deno check`.
        .select(
          "id, tenant_id, parent_id, expires_at, parents(profiles(full_name, email)), tenants(display_name, logo_url, referral_discount_type, referral_discount_value)"
        )
        .eq("id", reward_id)
        .maybeSingle();
}

export function readPackage(svc: ServiceDb, package_id: string) {
  return svc
      .from("parent_packages")
      .select(
        "id, status, name, lesson_count, rate_per_lesson, total_value, amount_payable, discount_amount, expires_on, start_date, validity_weeks, public_token, offered_by, tenant_id, parents(profile_id, profiles(full_name, email)), tenants(display_name, logo_url), students!student_id(full_name)"
      )
      .eq("id", package_id)
      .maybeSingle();
}

/** The caller's home tenant (a confirm's authz input). */
export function readCallerTenant(svc: ServiceDb, caller: { id: string }) {
  return svc
        .from("profiles")
        .select("tenant_id")
        .eq("id", caller.id)
        .maybeSingle();
}
