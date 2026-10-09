// Pure unit tests for the credit-note email builders, deciders and sender contract.
// No stack needed; run by generate-invoices/test.sh alongside the others.
//
// Every test names the ⚠ RISK it pins from docs/plans/CREDIT_NOTE_EMAIL_PLAN.md.
// The pass/fail values are the plan's own assertions, so a regression here reads as
// "this mitigation is gone", not "a string changed".

import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  authorizeCreditNoteEmail,
  buildCreditNoteHtml,
  buildCreditNoteSubject,
  canEmailForTenant,
  type CreditNoteEmailData,
  formatDate,
  isSendableNote,
  sendCreditNoteEmail,
  outcomeForStatus,
  settleActionFor,
  type SendOutcome,
} from "./email.ts";

const base: CreditNoteEmailData = {
  parentName: "Mrs Tan",
  businessName: "Coastal Swim School",
  logoUrl: null,
  referenceNumber: "CN-2026-0007",
  amount: 30,
  creditBalance: 60,
  studentName: "Wei Ling",
  classTitle: "Saturday Beginners",
  sessionDate: "2026-08-15",
  reason: "Pool closed — thunderstorm",
};

// ── Builders ────────────────────────────────────────────────────────────────

Deno.test("subject carries the amount, the business and the reference", () => {
  assertEquals(
    buildCreditNoteSubject(base),
    "S$30.00 credited to your Coastal Swim School account — CN-2026-0007",
  );
});

Deno.test("body carries the lesson, the reference and the coach's reason", () => {
  const html = buildCreditNoteHtml(base);
  assertStringIncludes(html, "Wei Ling");
  assertStringIncludes(html, "Saturday Beginners");
  assertStringIncludes(html, "15 Aug 2026");
  assertStringIncludes(html, "CN-2026-0007");
  assertStringIncludes(html, "Pool closed — thunderstorm");
  // Branded as the business; SwimSync only in the footer.
  assertStringIncludes(html, "Coastal Swim School");
  assertStringIncludes(html, "Sent via SwimSync");
});

Deno.test("no reason given: the reason line is omitted, not left empty", () => {
  const html = buildCreditNoteHtml({ ...base, reason: null });
  assertFalse(html.includes("Reason given:"));
});

// ⚠ RISK 11 — two labelled numbers, ALWAYS both.
Deno.test("⚠ RISK 11: renders this note's amount AND the labelled total separately", () => {
  const html = buildCreditNoteHtml(base);
  assertStringIncludes(html, "This credit note");
  assertStringIncludes(html, "S$30.00");
  assertStringIncludes(html, "Total credit with Coastal Swim School");
  assertStringIncludes(html, "S$60.00");
});

// The case that would tempt a "don't repeat the same number" shortcut. A parent
// with one credit note sees amount == balance; both lines must still appear, or
// the multi-sibling email (where they differ) is the only one that reads correctly.
Deno.test("⚠ RISK 11: both lines render even when amount === creditBalance", () => {
  const html = buildCreditNoteHtml({ ...base, amount: 30, creditBalance: 30 });
  assertStringIncludes(html, "This credit note");
  assertStringIncludes(html, "Total credit with Coastal Swim School");
  // The business is named in the balance line so it cannot be confused with the
  // parent app's cross-tenant pooled total (home/index.tsx:154).
  assert(
    html.indexOf("Total credit with Coastal Swim School") >
      html.indexOf("This credit note"),
    "the total must follow this note's amount, not replace it",
  );
});

Deno.test("body says the credit is applied automatically (PRD §5.6)", () => {
  const html = buildCreditNoteHtml(base);
  assertStringIncludes(html, "applied automatically to your next invoice");
});

// ⚠ RISK 6 IS NOT TESTED HERE — deliberately.
//
// This file once asserted that buildCreditNoteHtml({...base, studentName: "old name"})
// renders "old name". That is true regardless of the implementation — it only proves
// the builder interpolates its own argument, which the test at :44 already covers. It
// was a vacuous gate: the actual risk is that the QUERY reads a live join and passes
// the CURRENT name in, which no builder-level test can see.
//
// The real assertion lives in core.test.ts: rename the child through `students`, then
// re-read via NOTE_SELECT and assert the note still carries the pre-rename snapshot
// (§7.155). There is also a structural check there that NOTE_SELECT contains no
// students( / classes( / lesson_sessions( join at all.

Deno.test("html-escapes a business, child or reason containing markup", () => {
  const html = buildCreditNoteHtml({
    ...base,
    studentName: '<script>alert("x")</script>',
    reason: "5 < 6 & \"quoted\"",
  });
  assertFalse(html.includes("<script>"));
  assertStringIncludes(html, "&lt;script&gt;");
  assertStringIncludes(html, "5 &lt; 6 &amp;");
});

// ⚠ RISK 13 — formatDate never builds a Date, so it cannot drift a day in SGT.
Deno.test("⚠ RISK 13: formatDate parses the string, no Date object, no drift", () => {
  assertEquals(formatDate("2026-08-15"), "15 Aug 2026");
  assertEquals(formatDate("2026-01-01"), "1 Jan 2026");
  assertEquals(formatDate("2026-12-31"), "31 Dec 2026");
  // September is "Sept" — the apps' en-SG spelling, and the DB's since 20261009000100 (§7.302).
  assertEquals(formatDate("2026-09-06"), "6 Sept 2026");
  // Malformed input degrades to itself rather than to "Invalid Date".
  assertEquals(formatDate("not-a-date"), "not-a-date");
  assertEquals(formatDate("2026-13-01"), "2026-13-01");
});

// ── ⚠ RISK 4 — authority ────────────────────────────────────────────────────

Deno.test("⚠ RISK 4: session path mirrors attendance_write — main coach OR tenant admin", () => {
  const none = {
    isMainOnSession: false,
    isAdminOfSessionTenant: false,
    isTenantAdminOfNoteTenant: false,
  };
  assert(authorizeCreditNoteEmail("session", { ...none, isMainOnSession: true }));
  assert(authorizeCreditNoteEmail("session", { ...none, isAdminOfSessionTenant: true }));
  assertFalse(authorizeCreditNoteEmail("session", none));
});

Deno.test("⚠ RISK 4: note path requires a TENANT admin — session authority is not enough", () => {
  // The whole point: can_admin_tenant includes is_platform_admin(), so a platform
  // admin must NOT be able to send mail in a business's name. The only field that
  // can authorize the note path is is_tenant_admin's own result.
  assertFalse(
    authorizeCreditNoteEmail("note", {
      isMainOnSession: true,
      isAdminOfSessionTenant: true, // ← what can_admin_tenant would have returned
      isTenantAdminOfNoteTenant: false,
    }),
  );
  assert(
    authorizeCreditNoteEmail("note", {
      isMainOnSession: false,
      isAdminOfSessionTenant: false,
      isTenantAdminOfNoteTenant: true,
    }),
  );
});

// ── ⚠ RISK 2 — only virgin notes may be emailed ─────────────────────────────

Deno.test("⚠ RISK 2: a virgin available note is sendable", () => {
  assert(isSendableNote({
    status: "available",
    appliedToInvoiceId: null,
    hasApplications: false,
  }));
});

Deno.test("⚠ RISK 2: an applied note is refused", () => {
  assertFalse(isSendableNote({
    status: "applied",
    appliedToInvoiceId: "e0000000-0000-0000-0000-000000000001",
    hasApplications: true,
  }));
});

// The case status alone would miss, and the reason the credit_applications check
// exists: core.ts:1437-1445 leaves status 'available' while the note is part-spent.
Deno.test("⚠ RISK 2: a PARTLY applied note is refused though status is still 'available'", () => {
  assertFalse(isSendableNote({
    status: "available",
    appliedToInvoiceId: null,
    hasApplications: true, // one credit_applications row → part-spent
  }));
});

Deno.test("⚠ RISK 2: applied_to_invoice_id alone is enough to refuse", () => {
  assertFalse(isSendableNote({
    status: "available",
    appliedToInvoiceId: "e0000000-0000-0000-0000-000000000001",
    hasApplications: false,
  }));
});

// ── ⚠ RISK 10 — suspended tenants ───────────────────────────────────────────

Deno.test("⚠ RISK 10: a suspended business never emails; a live one does", () => {
  assertFalse(canEmailForTenant({ suspended: true }));
  assert(canEmailForTenant({ suspended: false }));
});

// ── ⚠ RISK 7 — the settle table (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.2) ─────────

Deno.test("⚠ RISK 7: release the claim only on provably pre-send outcomes", () => {
  // Pre-send: nothing reached the parent, so the note must become resendable.
  assertEquals(settleActionFor("no_api_key"), "release");
  assertEquals(settleActionFor("no_recipient"), "release");
  assertEquals(settleActionFor("rejected"), "release"); // Resend answered 4xx = refused

  // May ALREADY be in the parent's inbox. KEEP the claim: releasing it is what
  // produced a duplicate when the admin then pressed Resend. The claim is now a
  // 15-minute lease, so keeping it no longer strands the note.
  assertEquals(settleActionFor("threw"), "keep");
  assertEquals(settleActionFor("server_error"), "keep");
  assertEquals(settleActionFor("key_in_flight"), "keep");

  // Sent — including a 409 saying this key was already accepted.
  assertEquals(settleActionFor("ok"), "sent");
  assertEquals(settleActionFor("key_reused"), "sent");
});

Deno.test("⚠ RISK 7: every outcome is decided explicitly — no default branch", () => {
  const all: SendOutcome[] = [
    "no_api_key", "no_recipient", "rejected", "key_reused", "key_in_flight",
    "server_error", "threw", "ok",
  ];
  for (const o of all) {
    assert(["sent", "release", "keep"].includes(settleActionFor(o)), `outcome ${o} undecided`);
  }
});

Deno.test("outcomeForStatus: the two idempotency 409s are told apart by name", () => {
  const body = (name: string) => JSON.stringify({ statusCode: 409, name, message: "m" });
  assertEquals(outcomeForStatus(409, body("invalid_idempotent_request")), "key_reused");
  assertEquals(outcomeForStatus(409, body("concurrent_idempotent_requests")), "key_in_flight");
  assertEquals(outcomeForStatus(409, "not json"), "rejected");
  assertEquals(outcomeForStatus(422, body("validation_error")), "rejected");
  assertEquals(outcomeForStatus(502, ""), "server_error");
});

Deno.test("sends the Idempotency-Key header when given one", async () => {
  const original = globalThis.fetch;
  let key: string | undefined;
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit) => {
    key = (init?.headers as Record<string, string>)["Idempotency-Key"];
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  try {
    await sendCreditNoteEmail({
      apiKey: "re_test", to: "p@example.com", subject: "s", html: "h",
      fromName: "Coastal Swim School", idempotencyKey: "credit-note/n1/1700000000000",
    });
    assertEquals(key, "credit-note/n1/1700000000000");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("a 409 invalid_idempotent_request reports sent (settles SENT)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response(
      JSON.stringify({ statusCode: 409, name: "invalid_idempotent_request", message: "m" }),
      { status: 409 },
    ));
  try {
    const r = await sendCreditNoteEmail({
      apiKey: "re_test", to: "p@example.com", subject: "s", html: "h",
      fromName: "Coastal Swim School", idempotencyKey: "k",
    });
    assertEquals(r.outcome, "key_reused");
    assert(r.sent);
    assertEquals(settleActionFor(r.outcome), "sent");
  } finally {
    globalThis.fetch = original;
  }
});

// ── Sender contract ─────────────────────────────────────────────────────────

Deno.test("no API key: a logged no-op, typed pre-send so the claim releases", async () => {
  const r = await sendCreditNoteEmail({
    apiKey: undefined,
    to: "parent@example.com",
    subject: "s",
    html: "<p>h</p>",
    fromName: "Coastal Swim School",
  });
  assertFalse(r.sent);
  assertEquals(r.outcome, "no_api_key");
  assertEquals(settleActionFor(r.outcome), "release");
});

Deno.test("no recipient: refused before any network call, claim releases", async () => {
  const r = await sendCreditNoteEmail({
    apiKey: "re_test",
    to: undefined,
    subject: "s",
    html: "<p>h</p>",
    fromName: "Coastal Swim School",
  });
  assertFalse(r.sent);
  assertEquals(r.outcome, "no_recipient");
  assertEquals(settleActionFor(r.outcome), "release");
});

// The two that decide whether a real parent gets a duplicate. Stubbing fetch is
// the only way to reach them — they are exactly the paths a live run cannot show.
Deno.test("⚠ RISK 7: a THROWN fetch reports sent-unknown and KEEPS the claim", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("connection timed out"));
  try {
    const r = await sendCreditNoteEmail({
      apiKey: "re_test",
      to: "parent@example.com",
      subject: "s",
      html: "<p>h</p>",
      fromName: "Coastal Swim School",
    });
    assertFalse(r.sent);
    assertEquals(r.outcome, "threw");
    assertEquals(settleActionFor(r.outcome), "keep"); // ← the duplicate-email guard
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("⚠ RISK 7: a 5xx keeps the claim, a 4xx releases it", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(new Response("upstream boom", { status: 503 }));
    const five = await sendCreditNoteEmail({
      apiKey: "re_test", to: "p@example.com", subject: "s", html: "h",
      fromName: "Coastal Swim School",
    });
    assertEquals(five.outcome, "server_error");
    assertEquals(settleActionFor(five.outcome), "keep");

    globalThis.fetch = () =>
      Promise.resolve(new Response("bad address", { status: 422 }));
    const four = await sendCreditNoteEmail({
      apiKey: "re_test", to: "p@example.com", subject: "s", html: "h",
      fromName: "Coastal Swim School",
    });
    assertEquals(four.outcome, "rejected");
    assertEquals(settleActionFor(four.outcome), "release");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("a 2xx is sent, and settles SENT", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
  try {
    const r = await sendCreditNoteEmail({
      apiKey: "re_test", to: "p@example.com", subject: "s", html: "h",
      fromName: "Coastal Swim School",
    });
    assert(r.sent);
    assertEquals(r.outcome, "ok");
    assertEquals(settleActionFor(r.outcome), "sent");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("sends as the BUSINESS, from the shared SwimSync address", async () => {
  const original = globalThis.fetch;
  let seenFrom = "";
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit) => {
    seenFrom = JSON.parse(String(init?.body)).from;
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  try {
    await sendCreditNoteEmail({
      apiKey: "re_test", to: "p@example.com", subject: "s", html: "h",
      fromName: "Coastal Swim School",
    });
    assertEquals(seenFrom, "Coastal Swim School <noreply@swimsync.sg>");
  } finally {
    globalThis.fetch = original;
  }
});
