// test/createdEmails.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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
import { emailCreatedInvoices, retryUnsentInvoiceEmails } from "../domain/emailDelivery.ts";
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
// site. See test/helpers.ts for why (short version: `docs/GOTCHAS.md` §7.25).

Deno.test("result.created surfaces new invoices with line items (for emailing)", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-03") });
  try {
    const a = await s.addSession("2026-03-07"); await s.mark(a, "present");
    const b = await s.addSession("2026-03-14"); await s.mark(b, "present");
    const c = await s.addSession("2026-03-21"); await s.mark(c, "absent");
    await s.completeMonth("2026-03");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-03",
      now: s.now,
    });
    assertEquals(res.invoices_created, 1);
    assert(res.created, "created list should be present");
    assertEquals(res.created!.length, 1);

    const c0 = res.created![0];
    assertEquals(c0.parent_id, s.parentId);
    assertEquals(c0.billing_month, "2026-03");
    assertEquals(c0.net, 60);
    assertEquals(c0.items.length, 2); // 2 present; absent excluded
    assert(c0.items.every((i) => i.amount === 30));
    assert(
      c0.items.every(
        (i) => typeof i.session_date === "string" && i.class_title.length > 0
      )
    );

    // A re-run must NOT re-surface the same invoice (no double-email).
    const res2 = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-03",
      now: s.now,
    });
    assertEquals(res2.invoices_created, 0);
    assertEquals((res2.created ?? []).length, 0);
  } finally {
    await s.teardown();
  }
});

Deno.test("emailCreatedInvoices: resolves recipients against the DB, no-ops without a key", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-04") });
  try {
    const a = await s.addSession("2026-04-04"); await s.mark(a, "present");
    await s.completeMonth("2026-04");
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-04",
      now: s.now,
    });
    assertEquals(res.invoices_created, 1);

    // No key → sends nothing, and must not throw even though it queries the DB
    // for parent/student names. This is the money-path-isolation guarantee.
    const out = await emailCreatedInvoices(s.db, res.created ?? [], { apiKey: undefined });
    assertEquals(out.emailsSent, 0);
  } finally {
    await s.teardown();
  }
});

Deno.test("emailCreatedInvoices: with a key, emails each invoice to the resolved parent", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-05") });
  const orig = globalThis.fetch;
  const resendCalls: Array<Record<string, string>> = [];
  // Intercept only the Resend call; delegate all Supabase traffic to real fetch.
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      resendCalls.push(JSON.parse((init?.body as string) ?? "{}"));
      return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    }
    return orig(url as string | URL | Request, init);
  }) as typeof fetch;
  try {
    const a = await s.addSession("2026-05-02"); await s.mark(a, "present");
    await s.completeMonth("2026-05");
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-05",
      now: s.now,
    });
    assertEquals(res.invoices_created, 1);

    const out = await emailCreatedInvoices(s.db, res.created ?? [], { apiKey: "re_test" });
    assertEquals(out.emailsSent, 1);
    assertEquals(resendCalls.length, 1);
    // Recipient, parent name, student name and month all resolved from the DB.
    assertEquals(resendCalls[0].to, `parent-${s.tag}@test.local`);
    assertStringIncludes(resendCalls[0].subject, "May 2026");
    assertStringIncludes(resendCalls[0].html, `Parent ${s.tag}`);
    assertStringIncludes(resendCalls[0].html, `Kid ${s.tag}`);
  } finally {
    globalThis.fetch = orig;
    await s.teardown();
  }
});

// Overdue plan Unit 2 (OVERDUE_INVOICES_PLAN.md ⚠ RISK 2): the due date is the
// STORED column (trigger: SGT generated date + tenants.invoice_payment_days),
// carried on result.created AND on the retry rebuild — both email paths print it.
Deno.test("due date: created + retried emails print the stored due_date (tenant on 7 days)", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-05") });
  const orig = globalThis.fetch;
  const resendCalls: Array<Record<string, string>> = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      resendCalls.push(JSON.parse((init?.body as string) ?? "{}"));
      return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    }
    return orig(url as string | URL | Request, init);
  }) as typeof fetch;
  try {
    // The scenario's tenant is torn down with it, so the 7 cannot leak (§7.15).
    const { error: upErr } = await s.db.from("tenants")
      .update({ invoice_payment_days: 7 }).eq("id", s.tenantId);
    assertEquals(upErr, null);

    const a = await s.addSession("2026-05-02"); await s.mark(a, "present");
    await s.completeMonth("2026-05");
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-05", now: s.now,
    });
    assertEquals(res.invoices_created, 1);

    const { data: row } = await s.db.from("invoices")
      .select("id, generated_at, due_date").eq("id", res.created![0].invoice_id).single();
    // SGT date of the stamp + 7, computed independently of the SQL.
    const sgDate = new Date(row!.generated_at).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
    const [y, m, d] = sgDate.split("-").map(Number);
    const expected = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
    assertEquals(row!.due_date, expected, "stored due date = SGT generated date + 7");
    assertEquals(res.created![0].due_date, row!.due_date, "result.created carries the stored date");

    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const [ey, em, ed] = expected.split("-").map(Number);
    const label = `${ed} ${MONTHS[em - 1]} ${ey}`;

    // First send has NO key → released (UNSENT), nothing left our side.
    await emailCreatedInvoices(s.db, res.created ?? [], {});
    assertEquals(resendCalls.length, 0);

    // The retry path rebuilds from INVOICE_EMAIL_SELECT — it must carry due_date too.
    const r = await retryUnsentInvoiceEmails(s.db, s.tenantId, "2026-05", { apiKey: "re_test" });
    assertEquals(r.emailsRetried, 1);
    assertEquals(resendCalls.length, 1);
    assertStringIncludes(resendCalls[0].html, "Please pay by");
    assertStringIncludes(resendCalls[0].html, `>${label}</strong>`);
  } finally {
    globalThis.fetch = orig;
    await s.teardown();
  }
});
