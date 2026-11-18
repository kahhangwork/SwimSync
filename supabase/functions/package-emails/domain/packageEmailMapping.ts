// What a package / referral-reward email says and WHO it goes to, from the rows the
// dao read — moved verbatim out of index.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B11).
//
// Pure. Every Array.isArray normaliser and every `?.` is exactly as it was: PostgREST
// returns a to-one embed as an object OR a one-element array, and an embed RLS hides
// is null — a null must give NO recipient (no send), never a crash and never a
// different family's address (RISK 5). Pinned by packageEmailMapping.test.ts
// (characterisation tests).

import {
  buildConfirmedHtml,
  buildConfirmedSubject,
  buildOfferedHtml,
  buildOfferedSubject,
  buildRequestedHtml,
  buildRequestedSubject,
  sgDateOfStamp,
  type PackageEmailData,
  type ReferralRewardEmailData,
} from "./email.ts";
import type { readPackage, readReferralReward } from "../dao/packageEmails.repo.ts";

export type RewardRow = NonNullable<Awaited<ReturnType<typeof readReferralReward>>["data"]>;
export type PackageRow = NonNullable<Awaited<ReturnType<typeof readPackage>>["data"]>;

/** referral_reward — its OWN recipient path (RISK 3): the REFERRER (the reward's own
 *  parent), never a package's parent; the data carries no field from the referee's
 *  package. */
export function referralRewardEmail(reward: RewardRow): {
  to: string | undefined;
  data: ReferralRewardEmailData;
} {
      const rParent = Array.isArray(reward.parents)
        ? reward.parents[0] : reward.parents;
      const rProfile = Array.isArray(rParent?.profiles)
        ? rParent?.profiles?.[0] : rParent?.profiles;
      const rTenant = Array.isArray(reward.tenants)
        ? reward.tenants[0] : reward.tenants;

      const rData: ReferralRewardEmailData = {
        businessName: rTenant?.display_name ?? "Your coach",
        logoUrl: rTenant?.logo_url ?? null,
        discountType: (rTenant?.referral_discount_type as
          "percent" | "amount" | null) ?? null,
        discountValue: rTenant?.referral_discount_value != null
          ? Number(rTenant.referral_discount_value) : null,
        // The SGT date, never a raw UTC slice (§7.7) — see sgDateOfStamp.
        expiresOn: reward.expires_at
          ? sgDateOfStamp(String(reward.expires_at)) : null,
      };
  return { to: rProfile?.email as string | undefined, data: rData };
}

/** The package's parent, tenant and parent profile, normalised; `to` is that
 *  parent's email (undefined → nothing is sent). */
export function packageEmailParties(pkg: PackageRow) {
    const parent = Array.isArray(pkg.parents) ? pkg.parents[0] : pkg.parents;
    const tenant = Array.isArray(pkg.tenants) ? pkg.tenants[0] : pkg.tenants;
    const parentProfile = Array.isArray(parent?.profiles)
      ? parent?.profiles?.[0]
      : parent?.profiles;
  return { parent, tenant, parentProfile, to: parentProfile?.email as string | undefined };
}

type Parties = ReturnType<typeof packageEmailParties>;

/** A one-child package's child (PRD §7.16 single-child packages), or null for a shared
 *  one (student_id NULL → no embed). Same object-or-array normalising as the parties. */
export function packageChildName(pkg: PackageRow): string | null {
  const student = Array.isArray(pkg.students) ? pkg.students[0] : pkg.students;
  return student?.full_name?.trim() || null;
}

export function packageEmailData(
  pkg: PackageRow,
  parentProfile: Parties["parentProfile"],
  tenant: Parties["tenant"],
  APP_URL: string,
): PackageEmailData {
    const data: PackageEmailData = {
      parentName: parentProfile?.full_name ?? "there",
      businessName: tenant?.display_name ?? "Your coach",
      logoUrl: tenant?.logo_url ?? null,
      packageName: pkg.name as string,
      lessonCount: Number(pkg.lesson_count),
      ratePerLesson: Number(pkg.rate_per_lesson),
      totalValue: Number(pkg.total_value),
      amountPayable: pkg.amount_payable != null ? Number(pkg.amount_payable) : undefined,
      discountAmount: pkg.discount_amount != null ? Number(pkg.discount_amount) : undefined,
      expiresOn: (pkg.expires_on as string | null) ?? null,
      startDate: (pkg.start_date as string | null) ?? null,
      payUrl: pkg.public_token
        ? `${APP_URL}/package/${pkg.public_token}`
        : null,
      childName: packageChildName(pkg),
    };
  return data;
}

/** Subject and HTML for a package email; anything not requested/offered is a confirm. */
export function packageEmailContent(type: string, data: PackageEmailData): { subject: string; html: string } {
    const subject =
      type === "requested"
        ? buildRequestedSubject(data)
        : type === "offered"
        ? buildOfferedSubject(data)
        : buildConfirmedSubject(data);
    const html =
      type === "requested"
        ? buildRequestedHtml(data)
        : type === "offered"
        ? buildOfferedHtml(data)
        : buildConfirmedHtml(data);
  return { subject, html };
}
