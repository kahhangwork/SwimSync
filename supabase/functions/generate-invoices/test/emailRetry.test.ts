// test/emailRetry.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
// Integration tests for the billing engine (core.ts) against the local
// Supabase stack. Run with ./test.sh (or export SERVICE_ROLE_KEY first, then
// `deno test --allow-net --allow-env core.test.ts`). Requires `supabase start`.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { generateInvoices } from "../core.ts";
import { emailCreatedInvoices, retryUnsentInvoiceEmails } from "../email.ts";
import {
  newScenario,
  monthEnded,
  getInvoice,
  checkInvariants,
  svc,
} from "./helpers.ts";

// THE CLOCK IS PART OF THE FIXTURE, NOT AN AFTERTHOUGHT.
// The engine refuses a billing month that has not ended, so every test that
// bills a month must say when it is running. `monthEnded("YYYY-MM")` supplies
// the month, a clock at which it is billable, and an enrolment date early
// enough for the whole month's lessons to derive — as one inseparable fact.
// Pass `now: s.now` to generateInvoices; never re-derive a date at the call
// site. See test-helpers.ts for why (short version: `docs/GOTCHAS.md` §7.25).

// ── Invoice-email delivery tracking + retry (INVOICE_EMAIL_RETRY_PLAN.md) ────
// A dropped invoice email self-heals: re-running generate-invoices for the same
// (tenant, month) re-sends ONLY the misses, even on a sealed month, with no
// duplicate to parents who already got theirs.
//
// NOTE ON ⚠ RISK 4 (stamp failure must not drop the batch): each invoice's
// claim → send → settle runs inside its own try/catch, and settleInvoiceEmail
// never throws (email.ts), so a settle error cannot affect any other invoice.
// Covered structurally, not by a fault-injection test.
//
// The crash-safe claim (claimed_at lease, Idempotency-Key, MAY_HAVE_SENT) has
// its own file: emailClaim.test.ts.

// Intercept ONLY the Resend HTTP call; delegate Supabase traffic to real fetch.
// `statusFor` picks the HTTP status per call; `calls` records the sent bodies.
function resendStub(
  statusFor: (body: Record<string, string>) => number,
  calls?: Record<string, string>[]
): typeof fetch {
  const orig = globalThis.fetch;
  return ((url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      calls?.push(body);
      return Promise.resolve(
        new Response(JSON.stringify({ id: "e1" }), { status: statusFor(body) })
      );
    }
    return orig(url as string | URL | Request, init);
  }) as typeof fetch;
}

// deno-lint-ignore no-explicit-any
async function sentAtFor(db: any, invoiceId: string): Promise<string | null> {
  const { data } = await db
    .from("invoices")
    .select("invoice_email_sent_at")
    .eq("id", invoiceId)
    .single();
  return (data?.invoice_email_sent_at ?? null) as string | null;
}

Deno.test("invoice email: a successful send STAMPS invoice_email_sent_at", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  const orig = globalThis.fetch;
  globalThis.fetch = resendStub(() => 200);
  try {
    const a = await s.addSession("2026-06-06"); await s.mark(a, "present");
    await s.completeMonth("2026-06");
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06", now: s.now,
    });
    const inv = await getInvoice(s.db, s.parentId, "2026-06");
    assertEquals(await sentAtFor(s.db, inv!.id), null); // not sent yet

    await emailCreatedInvoices(s.db, res.created ?? [], { apiKey: "re_test" });
    assert(
      (await sentAtFor(s.db, inv!.id)) !== null,
      "a successful send must stamp invoice_email_sent_at"
    );
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("invoice email retry: a dropped send self-heals on a SEALED-month re-run, exactly once", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  const orig = globalThis.fetch;
  const calls: Record<string, string>[] = [];
  let status = 500; // Resend rejects the first send
  globalThis.fetch = resendStub(() => status, calls);
  try {
    const a = await s.addSession("2026-06-06"); await s.mark(a, "present");
    await s.completeMonth("2026-06");
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06", now: s.now,
    });
    const inv = await getInvoice(s.db, s.parentId, "2026-06");

    // First send fails with a 5xx → attempted once, NOT stamped sent. The claim
    // is KEPT (a 5xx may have been delivered), so the row reads SENDING.
    await emailCreatedInvoices(s.db, res.created ?? [], { apiKey: "re_test" });
    assertEquals(calls.length, 1);
    assertEquals(await sentAtFor(s.db, inv!.id), null);

    // A non-forced re-run hits the sealed guard and creates NOTHING.
    const res2 = await generateInvoices(s.db, {
      tenant_id: s.tenantId, billing_month: "2026-06", now: s.now,
    });
    assertEquals(res2.status, "already_complete");

    // The 15-minute lease runs out (written, not waited for) → RETRYABLE.
    await s.db.from("invoices")
      .update({ invoice_email_claimed_at: new Date(Date.now() - 20 * 60_000).toISOString() })
      .eq("id", inv!.id);

    // Resend recovers; the retry pass heals the miss (sealed month notwithstanding).
    status = 200; calls.length = 0;
    const r1 = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-06", { apiKey: "re_test" });
    assertEquals(r1.emailsRetried, 1);
    assertEquals(calls.length, 1);
    assert((await sentAtFor(s.db, inv!.id)) !== null, "retry must stamp on success");

    // A SECOND retry sends nothing — no duplicate to a parent who already got theirs.
    calls.length = 0;
    const r2 = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-06", { apiKey: "re_test" });
    assertEquals(r2.emailsRetried, 0);
    assertEquals(calls.length, 0);
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("invoice email retry: a claim whose send is REFUSED (4xx) is released (stays retryable)", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-07") });
  const orig = globalThis.fetch;
  const calls: Record<string, string>[] = [];
  // A 4xx means Resend refused — provably nothing sent — so the claim is
  // released. (A 5xx KEEPS the claim instead: emailClaim.test.ts.)
  let status = 422;
  globalThis.fetch = resendStub(() => status, calls);
  try {
    const a = await s.addSession("2026-07-04"); await s.mark(a, "present");
    await s.completeMonth("2026-07");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07", now: s.now,
    });
    const inv = await getInvoice(s.db, s.parentId, "2026-07");
    assertEquals(await sentAtFor(s.db, inv!.id), null);

    // Retry, but Resend refuses: the claim is released, sent_at stays NULL.
    const r = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-07", { apiKey: "re_test" });
    assertEquals(r.emailsRetried, 0);
    assertEquals(calls.length, 1);
    assertEquals(
      await sentAtFor(s.db, inv!.id), null,
      "a failed retry must reset the stamp so a later run retries again"
    );

    // Now it recovers.
    status = 200; calls.length = 0;
    const r2 = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-07", { apiKey: "re_test" });
    assertEquals(r2.emailsRetried, 1);
    assert((await sentAtFor(s.db, inv!.id)) !== null);
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("invoice email retry: an already-stamped (backfilled) invoice is never re-emailed", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  const orig = globalThis.fetch;
  const calls: Record<string, string>[] = [];
  globalThis.fetch = resendStub(() => 200, calls);
  try {
    const a = await s.addSession("2026-06-06"); await s.mark(a, "present");
    await s.completeMonth("2026-06");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06", now: s.now,
    });
    const inv = await getInvoice(s.db, s.parentId, "2026-06");

    // Simulate the migration backfill: pre-stamp the row as already sent.
    await s.db.from("invoices")
      .update({ invoice_email_sent_at: new Date().toISOString() })
      .eq("id", inv!.id);

    const r = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-06", { apiKey: "re_test" });
    assertEquals(r.emailsRetried, 0);
    assertEquals(calls.length, 0, "a backfilled/sent invoice must not be re-emailed");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("invoice email retry: concurrent runs send each invoice AT MOST once (atomic claim ⚠ RISK 1)", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-07") });
  const orig = globalThis.fetch;
  const calls: Record<string, string>[] = [];
  globalThis.fetch = resendStub(() => 200, calls);
  try {
    const a = await s.addSession("2026-07-04"); await s.mark(a, "present");
    await s.completeMonth("2026-07");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07", now: s.now,
    });
    const inv = await getInvoice(s.db, s.parentId, "2026-07");
    assertEquals(await sentAtFor(s.db, inv!.id), null);

    // Two retry passes race for the same (tenant, month). The atomic UPDATE...
    // RETURNING claim must let only ONE of them send the invoice.
    const [r1, r2] = await Promise.all([
      retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-07", { apiKey: "re_test" }),
      retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-07", { apiKey: "re_test" }),
    ]);
    assertEquals(r1.emailsRetried + r2.emailsRetried, 1);
    assertEquals(calls.length, 1, "atomic claim must prevent a concurrent duplicate send");
  } finally { globalThis.fetch = orig; await s.teardown(); }
});

Deno.test("invoice email retry: excludeIds holds this run's invoices out of the claim (⚠ RISK 5)", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  const orig = globalThis.fetch;
  const calls: Record<string, string>[] = [];
  globalThis.fetch = resendStub(() => 200, calls);
  try {
    const a = await s.addSession("2026-06-06"); await s.mark(a, "present");
    await s.completeMonth("2026-06");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06", now: s.now,
    });
    const inv = await getInvoice(s.db, s.parentId, "2026-06");

    const r = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-06", {
      apiKey: "re_test", excludeIds: [inv!.id],
    });
    assertEquals(r.emailsRetried, 0);
    assertEquals(calls.length, 0);
    assertEquals(
      await sentAtFor(s.db, inv!.id), null,
      "an excluded invoice must be neither claimed nor sent"
    );
  } finally { globalThis.fetch = orig; await s.teardown(); }
});
