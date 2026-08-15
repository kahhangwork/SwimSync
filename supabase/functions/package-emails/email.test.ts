// Pure unit tests for the package email builders + sender no-op contract.
// No stack needed; run by generate-invoices/test.sh alongside the others.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  authorizePackageEmail,
  buildConfirmedHtml,
  buildConfirmedSubject,
  buildOfferedHtml,
  buildOfferedSubject,
  buildRequestedHtml,
  buildRequestedSubject,
  formatDate,
  sendPackageEmail,
  type PackageEmailData,
} from "./email.ts";

const base: PackageEmailData = {
  parentName: "Mrs Tan",
  businessName: "Coastal Swim School",
  logoUrl: null,
  packageName: "10 Group Lessons",
  lessonCount: 10,
  ratePerLesson: 40,
  totalValue: 400,
  expiresOn: "2027-07-10",
};

Deno.test("requested: subject and body carry the business, amount and next step", () => {
  assertEquals(
    buildRequestedSubject(base),
    "Your Coastal Swim School package request — pay S$400.00 by PayNow"
  );
  const html = buildRequestedHtml(base);
  assertStringIncludes(html, "S$400.00");
  assertStringIncludes(html, "10 Group Lessons");
  assertStringIncludes(html, "PayNow");
  // Branded as the business; SwimSync only in the footer.
  assertStringIncludes(html, "Coastal Swim School");
  assertStringIncludes(html, "Sent via SwimSync");
});

Deno.test("offered: subject + body carry the terms, start date and pay link", () => {
  const d: PackageEmailData = {
    ...base,
    startDate: "2026-09-01",
    payUrl: "https://swimsync.sg/package/deadbeefdeadbeefdeadbeefdeadbeef",
  };
  assertEquals(
    buildOfferedSubject(d),
    "Your next Coastal Swim School swim package is ready to pay",
  );
  const html = buildOfferedHtml(d);
  assertStringIncludes(html, "S$400.00");
  assertStringIncludes(html, "1 Sep 2026");
  assertStringIncludes(
    html,
    "https://swimsync.sg/package/deadbeefdeadbeefdeadbeefdeadbeef",
  );
  assertStringIncludes(html, "Pay by PayNow");
});

// ⚠ RISK 6 — the authorization matrix. A pay link must reach only families the
// caller is entitled to send to.
Deno.test("authz: an OFFER email needs a real admin + an actual offer row", () => {
  const offer = {
    status: "pending",
    offeredBy: "admin-1",
    parentProfileId: "parent-1",
    tenantId: "t-1",
  };
  // admin + real offer → allowed
  assert(authorizePackageEmail("offered", offer,
    { id: "admin-1", isAdminOfTenant: true, profileTenantId: "t-1" }));
  // parent (not admin) → refused, even though they own the row
  assert(!authorizePackageEmail("offered", offer,
    { id: "parent-1", isAdminOfTenant: false, profileTenantId: null }));
  // coach of the tenant (member, not admin) → refused
  assert(!authorizePackageEmail("offered", offer,
    { id: "coach-1", isAdminOfTenant: false, profileTenantId: "t-1" }));
  // admin, but a PARENT-created pending request (offered_by null) → refused
  assert(!authorizePackageEmail("offered", { ...offer, offeredBy: null },
    { id: "admin-1", isAdminOfTenant: true, profileTenantId: "t-1" }));
  // admin + offer already active → refused (only pending is payable)
  assert(!authorizePackageEmail("offered", { ...offer, status: "active" },
    { id: "admin-1", isAdminOfTenant: true, profileTenantId: "t-1" }));
});

Deno.test("authz: requested is the parent's own pending row; confirmed is the tenant admin", () => {
  const pkg = { status: "pending", offeredBy: null, parentProfileId: "parent-1", tenantId: "t-1" };
  assert(authorizePackageEmail("requested", pkg,
    { id: "parent-1", isAdminOfTenant: false, profileTenantId: null }));
  assert(!authorizePackageEmail("requested", pkg,
    { id: "someone-else", isAdminOfTenant: false, profileTenantId: null }));
  const active = { ...pkg, status: "active" };
  assert(authorizePackageEmail("confirmed", active,
    { id: "admin-1", isAdminOfTenant: true, profileTenantId: "t-1" }));
  assert(!authorizePackageEmail("confirmed", active,
    { id: "admin-1", isAdminOfTenant: true, profileTenantId: "t-OTHER" }));
});

Deno.test("confirmed: body carries the lesson count, value and expiry date", () => {
  assertEquals(
    buildConfirmedSubject(base),
    "Your Coastal Swim School package is active — 10 lessons"
  );
  const html = buildConfirmedHtml(base);
  assertStringIncludes(html, "10 × S$40.00");
  assertStringIncludes(html, "S$400.00");
  assertStringIncludes(html, "10 Jul 2027");
});

Deno.test("confirmed: a missing expiry renders no 'Valid until' row rather than a blank", () => {
  const html = buildConfirmedHtml({ ...base, expiresOn: null });
  assert(!html.includes("Valid until"));
});

Deno.test("HTML is escaped — a hostile business or package name cannot inject markup", () => {
  const html = buildRequestedHtml({
    ...base,
    businessName: `<script>alert(1)</script>`,
    packageName: `"quoted" & <b>bold</b>`,
  });
  assert(!html.includes("<script>"));
  assertStringIncludes(html, "&lt;script&gt;");
  assert(!html.includes("<b>bold</b>"));
});

Deno.test("formatDate never shifts across a timezone (string in, string out)", () => {
  assertEquals(formatDate("2027-01-01"), "1 Jan 2027");
  assertEquals(formatDate("not-a-date"), "not-a-date");
});

Deno.test("sender is a logged NO-OP without a key — local and tests never send", async () => {
  const r = await sendPackageEmail({
    apiKey: undefined,
    to: "parent@example.com",
    subject: "x",
    html: "<p>x</p>",
    fromName: "Test",
  });
  assertEquals(r, { sent: false, reason: "RESEND_API_KEY not set" });
});

Deno.test("sender refuses quietly with no recipient", async () => {
  const r = await sendPackageEmail({
    apiKey: "re_fake",
    to: undefined,
    subject: "x",
    html: "<p>x</p>",
    fromName: "Test",
  });
  assertEquals(r, { sent: false, reason: "no recipient" });
});
