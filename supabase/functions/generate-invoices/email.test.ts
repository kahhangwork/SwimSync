// Unit tests for the invoice email module. Pure — no Supabase stack, no real
// network (fetch is stubbed). Run via ./test.sh alongside core.test.ts, or:
//   deno test email.test.ts

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildInvoiceEmailHtml,
  buildInvoiceEmailSubject,
  formatBillingMonth,
  formatSessionDate,
  money,
  sendInvoiceEmail,
  type InvoiceEmailData,
} from "./email.ts";

const sample: InvoiceEmailData = {
  parentName: "Jane Tan",
  billingMonth: "2026-07",
  gross: 75,
  credit: 0,
  net: 75,
  items: [
    { studentName: "Ethan Tan", sessionDate: "2026-07-12", classTitle: "SwimSafer L5", amount: 35 },
    { studentName: "Mia Tan", sessionDate: "2026-07-05", classTitle: "Beginners", amount: 40 },
  ],
};

Deno.test("formatBillingMonth: YYYY-MM → 'Month YYYY', passthrough on junk", () => {
  assertEquals(formatBillingMonth("2026-07"), "July 2026");
  assertEquals(formatBillingMonth("2026-01"), "January 2026");
  assertEquals(formatBillingMonth("nope"), "nope");
});

Deno.test("formatSessionDate: no timezone drift, human format", () => {
  assertEquals(formatSessionDate("2026-07-12"), "12 Jul 2026");
  assertEquals(formatSessionDate("2026-12-01"), "1 Dec 2026");
  assertEquals(formatSessionDate("bad"), "bad");
});

Deno.test("money: 2dp SGD", () => {
  assertEquals(money(35), "S$35.00");
  assertEquals(money(0), "S$0.00");
});

Deno.test("subject names the billing month", () => {
  assertEquals(buildInvoiceEmailSubject(sample), "Your SwimSync invoice for July 2026");
});

Deno.test("html: contains parent, month, every line item, totals, pay prompt", () => {
  const html = buildInvoiceEmailHtml(sample);
  assertStringIncludes(html, "Jane Tan");
  assertStringIncludes(html, "July 2026");
  // both line items, with student names and formatted dates
  assertStringIncludes(html, "Ethan Tan");
  assertStringIncludes(html, "Mia Tan");
  assertStringIncludes(html, "SwimSafer L5");
  assertStringIncludes(html, "12 Jul 2026");
  assertStringIncludes(html, "5 Jul 2026");
  assertStringIncludes(html, "S$35.00");
  assertStringIncludes(html, "S$40.00");
  // totals + outstanding-payment copy
  assertStringIncludes(html, "S$75.00");
  assertStringIncludes(html, "PayNow");
  assertStringIncludes(html, "View invoice in the app");
});

Deno.test("html: items are date-sorted (earliest first)", () => {
  const html = buildInvoiceEmailHtml(sample);
  // Mia's 5 Jul line must render before Ethan's 12 Jul line
  assert(html.indexOf("5 Jul 2026") < html.indexOf("12 Jul 2026"));
});

Deno.test("html: net=0 shows 'fully covered by credit', no PayNow prompt", () => {
  const covered: InvoiceEmailData = { ...sample, gross: 75, credit: 75, net: 0 };
  const html = buildInvoiceEmailHtml(covered);
  assertStringIncludes(html, "fully covered by your credit balance");
  assert(!html.includes("PayNow"));
  // credit line rendered
  assertStringIncludes(html, "Credit applied");
});

Deno.test("html: escapes HTML in dynamic fields", () => {
  const evil = buildInvoiceEmailHtml({
    ...sample,
    parentName: "<script>x</script>",
  });
  assert(!evil.includes("<script>x</script>"));
  assertStringIncludes(evil, "&lt;script&gt;");
});

Deno.test("sendInvoiceEmail: no api key → no send, no fetch", async () => {
  let fetchCalled = false;
  const orig = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalled = true;
    return Promise.resolve(new Response("", { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await sendInvoiceEmail({ ...sample, apiKey: undefined, to: "a@b.com" });
    assertEquals(r.sent, false);
    assertEquals(r.reason, "no_api_key");
    assertEquals(fetchCalled, false);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("sendInvoiceEmail: no recipient → no send", async () => {
  const r = await sendInvoiceEmail({ ...sample, apiKey: "re_x", to: null });
  assertEquals(r.sent, false);
  assertEquals(r.reason, "no_recipient");
});

Deno.test("sendInvoiceEmail: success posts to Resend with correct payload", async () => {
  let called = false;
  let capturedUrl = "";
  let capturedInit: RequestInit = {};
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    called = true;
    capturedUrl = String(url);
    capturedInit = init ?? {};
    return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await sendInvoiceEmail({ ...sample, apiKey: "re_test", to: "jane@x.com" });
    assertEquals(r.sent, true);
    assert(called, "fetch should have been called");
    assertEquals(capturedUrl, "https://api.resend.com/emails");
    const headers = capturedInit.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer re_test");
    const body = JSON.parse(capturedInit.body as string);
    assertEquals(body.to, "jane@x.com");
    assertEquals(body.from, "SwimSync <noreply@swimsync.sg>");
    assertStringIncludes(body.subject, "July 2026");
    assertStringIncludes(body.html, "Jane Tan");
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("sendInvoiceEmail: non-2xx → not sent, reason carries status", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response("bad key", { status: 401 }))) as typeof fetch;
  try {
    const r = await sendInvoiceEmail({ ...sample, apiKey: "re_x", to: "a@b.com" });
    assertEquals(r.sent, false);
    assertStringIncludes(r.reason ?? "", "resend_401");
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("sendInvoiceEmail: fetch throws → caught, not sent", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    const r = await sendInvoiceEmail({ ...sample, apiKey: "re_x", to: "a@b.com" });
    assertEquals(r.sent, false);
    assertStringIncludes(r.reason ?? "", "fetch_error");
  } finally {
    globalThis.fetch = orig;
  }
});
