// Pure unit tests for the package email builders + sender no-op contract.
// No stack needed; run by generate-invoices/test.sh alongside the others.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildConfirmedHtml,
  buildConfirmedSubject,
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
