// Integration tests for the CRASH-SAFE invoice email claim, against the local
// stack. Plan: docs/plans/CRASH_SAFE_EMAIL_CLAIM_PLAN.md (§3.2, §5).
//
// A literal kill between claim and send cannot be staged from a test. What CAN
// be, and is what the design rests on, is the LEASE: a claim that is never
// settled. Each test writes an old invoice_email_claimed_at (service_role is not
// pinned — only `authenticated` is) and checks what the next sender does. The
// boundaries themselves (exactly 15 min, exactly 24 h) are pinned in pgTAP
// (supabase/tests/email_claim.test.sql), where now() is controllable.
//
// Run twice (§7.15): every scenario is its own tenant and tears itself down.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { generateInvoices } from "./core.ts";
import {
  emailCreatedInvoices,
  resendInvoiceEmail,
  retryUnsentInvoiceEmails,
  settleInvoiceEmail,
} from "./email.ts";
import { getInvoice, monthEnded, newScenario, type Scenario } from "./test-helpers.ts";

type ResendCall = { body: Record<string, string>; key: string | undefined };

// Intercept ONLY the Resend call (recording body + Idempotency-Key); everything
// else — the Supabase traffic — goes to the real fetch.
function resendStub(
  answer: (call: ResendCall) => Response | Promise<Response>,
  calls: ResendCall[],
): typeof fetch {
  const orig = globalThis.fetch;
  return ((url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      const call = {
        body: JSON.parse((init?.body as string) ?? "{}"),
        key: (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"],
      };
      calls.push(call);
      return Promise.resolve(answer(call));
    }
    return orig(url as string | URL | Request, init);
  }) as typeof fetch;
}

const ok = () => new Response(JSON.stringify({ id: "e1" }), { status: 200 });
const status = (n: number, name?: string) =>
  new Response(JSON.stringify({ statusCode: n, name: name ?? "x", message: "m" }), { status: n });

/** One billed invoice for a fresh tenant. Nothing emailed yet. */
async function billedInvoice(month: string): Promise<{ s: Scenario; id: string; created: any[] }> {
  const s = await newScenario({ price: 30, billing: monthEnded(month) });
  try {
    const a = await s.addSession(`${month}-06`);
    await s.mark(a, "present");
    await s.completeMonth(month);
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: month, now: s.now,
    });
    const inv = await getInvoice(s.db, s.parentId, month);
    if (!inv) throw new Error("vacuous fixture — no invoice was generated");
    return { s, id: inv.id, created: res.created ?? [] };
  } catch (e) {
    await s.teardown();
    throw e;
  }
}

async function emailCols(s: Scenario, id: string) {
  const { data } = await s.db
    .from("invoices")
    .select("invoice_email_sent_at, invoice_email_claimed_at, invoice_email_state")
    .eq("id", id)
    .single();
  return data as {
    invoice_email_sent_at: string | null;
    invoice_email_claimed_at: string | null;
    invoice_email_state: string;
  };
}

/** Age the claim as if its sender died `minutes` ago. */
async function ageClaim(s: Scenario, id: string, minutes: number) {
  const { error } = await s.db
    .from("invoices")
    .update({ invoice_email_claimed_at: new Date(Date.now() - minutes * 60_000).toISOString() })
    .eq("id", id);
  if (error) throw new Error(`fixture: could not age the claim — ${error.message}`);
}

// ── Settle ───────────────────────────────────────────────────────────────────

Deno.test("claim: a first send claims, sends with key invoice/<id>, and settles SENT", async () => {
  const { s, id, created } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(ok, calls);
  try {
    const out = await emailCreatedInvoices(s.db, created, { apiKey: "re_test" });
    assertEquals(out.emailsSent, 1);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].key, `invoice/${id}`);
    const c = await emailCols(s, id);
    assert(c.invoice_email_sent_at !== null, "a 2xx stamps sent_at");
    assertEquals(c.invoice_email_claimed_at, null, "and clears the claim");
    assertEquals(c.invoice_email_state, "SENT");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("claim: a 5xx KEEPS the claim (SENDING) — the retry pass skips a fresh claim", async () => {
  const { s, id, created } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  let answer = () => status(503);
  globalThis.fetch = resendStub(() => answer(), calls);
  try {
    await emailCreatedInvoices(s.db, created, { apiKey: "re_test" });
    const c = await emailCols(s, id);
    assertEquals(c.invoice_email_sent_at, null);
    assert(c.invoice_email_claimed_at !== null, "a 5xx may have been delivered — the claim stands");
    assertEquals(c.invoice_email_state, "SENDING");

    // Within the lease, nothing retries it.
    answer = ok; calls.length = 0;
    const r = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-06", { apiKey: "re_test" });
    assertEquals(r.emailsRetried, 0);
    assertEquals(calls.length, 0, "a claim younger than 15 minutes is somebody's in-flight send");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("claim: an EXPIRED claim (a sender that died) is re-claimed and sent once, same key", async () => {
  const { s, id } = await billedInvoice("2026-07");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(ok, calls);
  try {
    // Before this migration this row would have looked SENT forever: the claim
    // WAS the sent marker. Now it is a lease.
    await ageClaim(s, id, 20);
    assertEquals((await emailCols(s, id)).invoice_email_state, "RETRYABLE");

    const r1 = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-07", { apiKey: "re_test" });
    assertEquals(r1.emailsRetried, 1);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].key, `invoice/${id}`, "the SAME key — inside 24 h Resend dedups it");
    assertEquals((await emailCols(s, id)).invoice_email_state, "SENT");

    calls.length = 0;
    const r2 = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-07", { apiKey: "re_test" });
    assertEquals(r2.emailsRetried, 0);
    assertEquals(calls.length, 0);
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("claim: a 409 invalid_idempotent_request settles SENT (the key was already accepted)", async () => {
  const { s, id } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(() => status(409, "invalid_idempotent_request"), calls);
  try {
    await ageClaim(s, id, 20);
    const r = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-06", { apiKey: "re_test" });
    assertEquals(r.emailsRetried, 1);
    assertEquals((await emailCols(s, id)).invoice_email_state, "SENT");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("claim: a 409 concurrent_idempotent_requests KEEPS the claim", async () => {
  const { s, id, created } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  globalThis.fetch = resendStub(() => status(409, "concurrent_idempotent_requests"), []);
  try {
    await emailCreatedInvoices(s.db, created, { apiKey: "re_test" });
    assertEquals((await emailCols(s, id)).invoice_email_state, "SENDING");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("claim: no API key releases the claim (UNSENT, never SENDING)", async () => {
  const { s, id, created } = await billedInvoice("2026-06");
  try {
    await emailCreatedInvoices(s.db, created, { apiKey: undefined });
    const c = await emailCols(s, id);
    assertEquals(c.invoice_email_claimed_at, null);
    assertEquals(c.invoice_email_state, "UNSENT");
  } finally { await s.teardown(); }
});

Deno.test("claim: a stale settle does NOTHING once the row was re-claimed", async () => {
  // Sender A claims, stalls past its lease; sender B re-claims and is mid-send.
  // A's late settle must not touch B's claim — it is conditional on A's token.
  const { s, id } = await billedInvoice("2026-06");
  try {
    const { data: a } = await s.db.rpc("claim_invoice_email", { p_invoice_id: id });
    const tokenA = (a as { claimed_at: string }[])[0].claimed_at;
    await ageClaim(s, id, 20);
    const { data: b } = await s.db.rpc("claim_invoice_email", { p_invoice_id: id });
    assertEquals((b as unknown[]).length, 1, "fixture: B re-claims the expired lease");

    await settleInvoiceEmail(s.db, id, tokenA, "sent");
    const c = await emailCols(s, id);
    assertEquals(c.invoice_email_sent_at, null, "A's stale settle must not stamp B's claim sent");
    assertEquals(c.invoice_email_state, "SENDING");
  } finally { await s.teardown(); }
});

// ── Concurrency ──────────────────────────────────────────────────────────────

Deno.test("claim: a first send racing a concurrent run's retry sends ONCE", async () => {
  // Before the first send claimed, it sent first and stamped after — so a
  // concurrent run's retry pass (excludeIds only covers its OWN run) could
  // claim and send the same just-created invoice: two emails to one parent.
  const { s, id, created } = await billedInvoice("2026-07");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  // Slow Resend, so both senders are genuinely in flight together.
  globalThis.fetch = resendStub(() => new Promise((r) => setTimeout(() => r(ok()), 150)), calls);
  try {
    const [first, retry] = await Promise.all([
      emailCreatedInvoices(s.db, created, { apiKey: "re_test" }),
      retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-07", { apiKey: "re_test" }),
    ]);
    assertEquals(first.emailsSent + retry.emailsRetried, 1);
    assertEquals(calls.length, 1, "one invoice, one email");
    assertEquals((await emailCols(s, id)).invoice_email_state, "SENT");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

// ── After 24 h: never automatic, human only, new key ────────────────────────

Deno.test("claim: a claim older than 24 h is NEVER picked by the automatic retry", async () => {
  const { s, id } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(ok, calls);
  try {
    await ageClaim(s, id, 25 * 60);
    assertEquals((await emailCols(s, id)).invoice_email_state, "MAY_HAVE_SENT");
    const r = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-06", { apiKey: "re_test" });
    assertEquals(r.emailsRetried, 0);
    assertEquals(calls.length, 0, "the key has lapsed — an automatic retry could duplicate");
    assertEquals((await emailCols(s, id)).invoice_email_state, "MAY_HAVE_SENT");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("resend: a human resend of MAY_HAVE_SENT sends once, under the invoice's one key", async () => {
  const { s, id } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(ok, calls);
  try {
    await ageClaim(s, id, 25 * 60);
    const r = await resendInvoiceEmail(s.db, id, { apiKey: "re_test" });
    assertEquals(r, { sent: true });
    assertEquals(calls.length, 1);
    // The key has lapsed (claim > 24 h old), so Resend sends it fresh — and
    // reusing it is what lets any later retry dedup against this send.
    assertEquals(calls[0].key, `invoice/${id}`);
    assertEquals((await emailCols(s, id)).invoice_email_state, "SENT");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("resend: an unknown-outcome human resend, auto-retried later, reuses the SAME key", async () => {
  // The duplicate path a per-resend key opened: human resend → 5xx (claim kept)
  // → 15 min on the row is RETRYABLE → the automatic retry sends again. With one
  // key per invoice, Resend dedups the retry against the human's send.
  const { s, id } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  let answer = () => status(503);
  globalThis.fetch = resendStub(() => answer(), calls);
  try {
    await ageClaim(s, id, 25 * 60);
    await resendInvoiceEmail(s.db, id, { apiKey: "re_test" });
    assertEquals((await emailCols(s, id)).invoice_email_state, "SENDING");

    await ageClaim(s, id, 20);
    answer = ok;
    const r = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-06", { apiKey: "re_test" });
    assertEquals(r.emailsRetried, 1);
    assertEquals(calls.map((c) => c.key), [`invoice/${id}`, `invoice/${id}`]);
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("resend: an UNSENT invoice resends under the NORMAL key", async () => {
  const { s, id } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(ok, calls);
  try {
    const r = await resendInvoiceEmail(s.db, id, { apiKey: "re_test" });
    assertEquals(r, { sent: true });
    assertEquals(calls[0].key, `invoice/${id}`);
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("resend: a double-pressed Resend sends ONCE", async () => {
  const { s, id } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(() => new Promise((r) => setTimeout(() => r(ok()), 150)), calls);
  try {
    await ageClaim(s, id, 25 * 60);
    const [a, b] = await Promise.all([
      resendInvoiceEmail(s.db, id, { apiKey: "re_test" }),
      resendInvoiceEmail(s.db, id, { apiKey: "re_test" }),
    ]);
    assertEquals([a, b].filter((r) => r.sent).length, 1);
    assertEquals(calls.length, 1);
    const loser = a.sent ? b : a;
    assertEquals(loser.reason, "sending", "the second press reports it is already being sent");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("resend: SENT → 'nothing to send'; SENDING → 'sending'; nothing goes out", async () => {
  const { s, id, created } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(ok, calls);
  try {
    await emailCreatedInvoices(s.db, created, { apiKey: "re_test" });
    calls.length = 0;
    assertEquals(await resendInvoiceEmail(s.db, id, { apiKey: "re_test" }), {
      sent: false, reason: "nothing to send",
    });

    // Put it back to a fresh in-flight claim.
    await s.db.from("invoices")
      .update({ invoice_email_sent_at: null, invoice_email_claimed_at: new Date().toISOString() })
      .eq("id", id);
    assertEquals(await resendInvoiceEmail(s.db, id, { apiKey: "re_test" }), {
      sent: false, reason: "sending",
    });
    assertEquals(calls.length, 0);
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("resend: a SUSPENDED business is never emailed in", async () => {
  const { s, id } = await billedInvoice("2026-06");
  const orig = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = resendStub(ok, calls);
  try {
    await s.db.from("tenants").update({ suspended_at: new Date().toISOString() }).eq("id", s.tenantId);
    assertEquals(await resendInvoiceEmail(s.db, id, { apiKey: "re_test" }), {
      sent: false, reason: "tenant suspended",
    });
    assertEquals(calls.length, 0);
  } finally {
    globalThis.fetch = orig;
    await s.db.from("tenants").update({ suspended_at: null }).eq("id", s.tenantId);
    await s.teardown();
  }
});
