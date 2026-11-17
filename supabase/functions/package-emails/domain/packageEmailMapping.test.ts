// CHARACTERISATION TESTS (EDGE_FUNCTIONS_REFACTOR_PLAN.md B11) — they pin behaviour
// that already existed in package-emails/index.ts before it was extracted, so §7.25's
// prove-it-red rule does not apply as written. The recipient case was mutation-proven
// instead: pointing `to` at the profile's full_name instead of its email turns
// "referral: the recipient is the REWARD's parent" red.
//
// What they pin: PostgREST returns a to-one embed as an object OR a one-element array
// (both must give the same email), and an embed RLS hides arrives as null — that must
// give NO recipient (undefined → nothing is sent), never a crash.

import { assertEquals } from "jsr:@std/assert@1";
import {
  buildConfirmedHtml,
  buildConfirmedSubject,
  buildOfferedHtml,
  buildOfferedSubject,
  buildRequestedHtml,
  buildRequestedSubject,
  type PackageEmailData,
} from "./email.ts";
import {
  packageEmailContent,
  packageEmailData,
  packageEmailParties,
  type PackageRow,
  referralRewardEmail,
  type RewardRow,
} from "./packageEmailMapping.ts";

const reward = (over: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    tenant_id: "t1",
    parent_id: "p1",
    expires_at: "2026-12-31T16:30:00+00:00", // 00:30 SGT on 1 Jan 2027
    parents: { profiles: { full_name: "Referrer Parent", email: "referrer@example.test" } },
    tenants: {
      display_name: "Little Fins",
      logo_url: "https://logo.test/l.png",
      referral_discount_type: "percent",
      referral_discount_value: 10,
    },
    ...over,
  }) as unknown as RewardRow;

const pkg = (over: Record<string, unknown> = {}) =>
  ({
    id: "k1",
    status: "pending",
    name: "10-lesson pack",
    lesson_count: 10,
    rate_per_lesson: 35,
    total_value: 350,
    amount_payable: 320,
    discount_amount: 30,
    expires_on: "2027-03-01",
    start_date: "2026-12-01",
    validity_weeks: 12,
    public_token: "0123456789abcdef0123456789abcdef",
    offered_by: "admin-1",
    tenant_id: "t1",
    parents: { profile_id: "prof-1", profiles: { full_name: "Pat Parent", email: "pat@example.test" } },
    tenants: { display_name: "Little Fins", logo_url: null },
    ...over,
  }) as unknown as PackageRow;

Deno.test("referral: the recipient is the REWARD's parent, data from the reward's tenant", () => {
  const { to, data } = referralRewardEmail(reward());
  assertEquals(to, "referrer@example.test");
  assertEquals(data, {
    businessName: "Little Fins",
    logoUrl: "https://logo.test/l.png",
    discountType: "percent",
    discountValue: 10,
    expiresOn: "2027-01-01", // the SGT date, not the UTC 2026-12-31
  });
});

Deno.test("referral: an ARRAY embed gives exactly what the object embed gives", () => {
  const asArrays = reward({
    parents: [{ profiles: [{ full_name: "Referrer Parent", email: "referrer@example.test" }] }],
    tenants: [{
      display_name: "Little Fins",
      logo_url: "https://logo.test/l.png",
      referral_discount_type: "percent",
      referral_discount_value: 10,
    }],
  });
  assertEquals(referralRewardEmail(asArrays), referralRewardEmail(reward()));
});

Deno.test("referral: an RLS-null parent / profile gives NO recipient; null tenant and expiry fall back", () => {
  assertEquals(referralRewardEmail(reward({ parents: null })).to, undefined);
  assertEquals(referralRewardEmail(reward({ parents: { profiles: null } })).to, undefined);
  const bare = referralRewardEmail(reward({ tenants: null, expires_at: null }));
  assertEquals(bare.data, {
    businessName: "Your coach",
    logoUrl: null,
    discountType: null,
    discountValue: null,
    expiresOn: null,
  });
});

Deno.test("package: object and array embeds give the same parties and recipient", () => {
  const a = packageEmailParties(pkg());
  const b = packageEmailParties(pkg({
    parents: [{ profile_id: "prof-1", profiles: [{ full_name: "Pat Parent", email: "pat@example.test" }] }],
    tenants: [{ display_name: "Little Fins", logo_url: null }],
  }));
  assertEquals(a.to, "pat@example.test");
  // What the email uses — recipient, profile, tenant, the parent's profile_id (the
  // authz input). `parent` itself keeps its own embed shape, so it is not compared.
  const used = (p: typeof a) => ({ to: p.to, parentProfile: p.parentProfile, tenant: p.tenant, profileId: p.parent?.profile_id });
  assertEquals(used(b), used(a));
  assertEquals(a.parent?.profile_id, "prof-1");
});

Deno.test("package: an RLS-null parent or profile gives NO recipient", () => {
  const noParent = packageEmailParties(pkg({ parents: null }));
  assertEquals(noParent.to, undefined);
  assertEquals(noParent.parentProfile, undefined);
  assertEquals(packageEmailParties(pkg({ parents: { profile_id: "prof-1", profiles: null } })).to, undefined);
});

Deno.test("package: the email data — numbers coerced, pay URL from the token, nulls kept", () => {
  const { parentProfile, tenant } = packageEmailParties(pkg());
  assertEquals(packageEmailData(pkg(), parentProfile, tenant, "https://swimsync.sg"), {
    parentName: "Pat Parent",
    businessName: "Little Fins",
    logoUrl: null,
    packageName: "10-lesson pack",
    lessonCount: 10,
    ratePerLesson: 35,
    totalValue: 350,
    amountPayable: 320,
    discountAmount: 30,
    expiresOn: "2027-03-01",
    startDate: "2026-12-01",
    payUrl: "https://swimsync.sg/package/0123456789abcdef0123456789abcdef",
  });
  const bare = pkg({ public_token: null, amount_payable: null, discount_amount: null, expires_on: null, start_date: null });
  const d = packageEmailData(bare, undefined, undefined, "https://swimsync.sg");
  assertEquals(
    [d.payUrl, d.amountPayable, d.discountAmount, d.expiresOn, d.startDate, d.parentName, d.businessName],
    [null, undefined, undefined, null, null, "there", "Your coach"],
  );
});

Deno.test("package: each type gets its own subject and HTML builder; anything else is a confirm", () => {
  const { parentProfile, tenant } = packageEmailParties(pkg());
  const data: PackageEmailData = packageEmailData(pkg(), parentProfile, tenant, "https://swimsync.sg");
  assertEquals(packageEmailContent("requested", data), { subject: buildRequestedSubject(data), html: buildRequestedHtml(data) });
  assertEquals(packageEmailContent("offered", data), { subject: buildOfferedSubject(data), html: buildOfferedHtml(data) });
  assertEquals(packageEmailContent("confirmed", data), { subject: buildConfirmedSubject(data), html: buildConfirmedHtml(data) });
});
