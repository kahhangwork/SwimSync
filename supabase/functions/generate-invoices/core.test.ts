// Integration tests for the billing engine (core.ts) against the local
// Supabase stack. Run with ./test.sh (or export SERVICE_ROLE_KEY first, then
// `deno test --allow-net --allow-env core.test.ts`). Requires `supabase start`.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { generateInvoices } from "./core.ts";
import { emailCreatedInvoices } from "./email.ts";
import {
  newScenario,
  getInvoice,
  checkInvariants,
} from "./test-helpers.ts";

Deno.test("bills only billable attendance; gross = sum of billable rates", async () => {
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2026-01-03"); await s.mark(a, "present");
    const b = await s.addSession("2026-01-10"); await s.mark(b, "present");
    const c = await s.addSession("2026-01-17"); await s.mark(c, "absent");
    const d = await s.addSession("2026-01-24"); await s.mark(d, "trial_free");

    const res = await generateInvoices(s.db, {
      mode: "manual",
      force: true,
      billing_month: "2026-01",
    });
    assertEquals(res.invoices_created, 1);

    const inv = await getInvoice(s.db, s.parentId, "2026-01");
    assertEquals(inv!.gross, 60); // 2 present * $30; absent + trial_free excluded
    assertEquals(inv!.net, 60);
    assertEquals(inv!.status, "outstanding");

    const { data: items } = await s.db
      .from("invoice_items")
      .select("attendance_status")
      .eq("invoice_id", inv!.id);
    assertEquals(items!.length, 2);
    assert(
      items!.every((i) => ["present", "trial_paid"].includes(i.attendance_status))
    );
  } finally {
    await s.teardown();
  }
});

Deno.test("paid trial is billable, free trial is not", async () => {
  const s = await newScenario({ price: 25 });
  try {
    const a = await s.addSession("2026-02-07"); await s.mark(a, "trial_paid");
    const b = await s.addSession("2026-02-14"); await s.mark(b, "trial_free");

    await generateInvoices(s.db, {
      mode: "manual",
      force: true,
      billing_month: "2026-02",
    });
    const inv = await getInvoice(s.db, s.parentId, "2026-02");
    assertEquals(inv!.gross, 25); // only the paid trial
  } finally {
    await s.teardown();
  }
});

Deno.test("no double-billing: second run skips the existing invoice", async () => {
  const s = await newScenario();
  try {
    const a = await s.addSession("2026-03-07"); await s.mark(a, "present");
    await generateInvoices(s.db, { mode: "manual", force: true, billing_month: "2026-03" });
    const res2 = await generateInvoices(s.db, { mode: "manual", force: true, billing_month: "2026-03" });
    assertEquals(res2.invoices_created, 0);

    const { data: invs } = await s.db
      .from("invoices")
      .select("id")
      .eq("parent_id", s.parentId)
      .eq("billing_month", "2026-03");
    assertEquals(invs!.length, 1);
  } finally {
    await s.teardown();
  }
});

Deno.test("completeness gate: auto skips a class with a missing mark, manual bills it", async () => {
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2026-04-04"); await s.mark(a, "present");
    await s.addSession("2026-04-11"); // no attendance -> class incomplete

    const auto = await generateInvoices(s.db, { mode: "auto", billing_month: "2026-04" });
    assertEquals(auto.invoices_created, 0);
    assert((auto.classes_still_incomplete ?? 0) >= 1);

    const man = await generateInvoices(s.db, { mode: "manual", force: true, billing_month: "2026-04" });
    assertEquals(man.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, "2026-04");
    assertEquals(inv!.gross, 30); // just the one present lesson
  } finally {
    await s.teardown();
  }
});

Deno.test("auto mode honours the auto_invoice_enabled switch", async () => {
  const s = await newScenario();
  try {
    const a = await s.addSession("2026-04-18"); await s.mark(a, "present");
    await s.db.from("app_settings").update({ value: false }).eq("key", "auto_invoice_enabled");

    const res = await generateInvoices(s.db, { mode: "auto", billing_month: "2026-04" });
    assertEquals(res.status, "auto_disabled");
    // early return before any processing
    assertEquals(res.invoices_created, undefined);
    const inv = await getInvoice(s.db, s.parentId, "2026-04");
    assertEquals(inv, null);
  } finally {
    await s.db.from("app_settings").update({ value: true }).eq("key", "auto_invoice_enabled");
    await s.teardown();
  }
});

Deno.test("credit note is applied FIFO to the next invoice; invariants hold", async () => {
  const s = await newScenario({ price: 30 });
  try {
    // Month 1: two present -> invoice $60
    const j1 = await s.addSession("2026-05-02"); await s.mark(j1, "present");
    const j2 = await s.addSession("2026-05-09"); await s.mark(j2, "present");
    await generateInvoices(s.db, { mode: "manual", force: true, billing_month: "2026-05" });

    // Correct an invoiced lesson to absent -> trigger issues a $30 credit note
    await s.mark(j1, "absent");
    assertEquals(await s.creditBalance(), 30);

    // Month 2: two present -> gross $60, $30 credit applied, net $30
    const f1 = await s.addSession("2026-06-06"); await s.mark(f1, "present");
    const f2 = await s.addSession("2026-06-13"); await s.mark(f2, "present");
    await generateInvoices(s.db, { mode: "manual", force: true, billing_month: "2026-06" });

    const inv = await getInvoice(s.db, s.parentId, "2026-06");
    assertEquals(inv!.gross, 60);
    assertEquals(inv!.credit_applied, 30);
    assertEquals(inv!.net, 30);
    assertEquals(await s.creditBalance(), 0);

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("edge 11.1: last-day-of-month lesson is billed in that month; next-month lesson is excluded (leap Feb)", async () => {
  const s = await newScenario({ price: 40 });
  try {
    // Leap-year last day (exercises core.ts lastDay = new Date(y, m, 0)),
    // plus a lesson on the 1st of the NEXT month that must NOT be swept in.
    const last = await s.addSession("2028-02-29"); await s.mark(last, "present");
    const next = await s.addSession("2028-03-01"); await s.mark(next, "present");

    await generateInvoices(s.db, {
      mode: "manual",
      force: true,
      billing_month: "2028-02",
    });

    const inv = await getInvoice(s.db, s.parentId, "2028-02");
    assertEquals(inv!.gross, 40); // only the Feb 29 lesson, not the Mar 1 one

    const { data: items } = await s.db
      .from("invoice_items")
      .select("session_date")
      .eq("invoice_id", inv!.id);
    assertEquals(items!.length, 1);
    assertEquals(items![0].session_date, "2028-02-29");
  } finally {
    await s.teardown();
  }
});

Deno.test("carry-forward: credit exceeding the invoice leaves a partial note and reconciles", async () => {
  const s = await newScenario({ price: 30 });
  try {
    // Month 1: one present @ $30 -> invoice $30
    const m1 = await s.addSession("2026-07-04"); await s.mark(m1, "present");
    await generateInvoices(s.db, { mode: "manual", force: true, billing_month: "2026-07" });

    // Correct -> $30 credit note
    await s.mark(m1, "absent");
    assertEquals(await s.creditBalance(), 30);

    // Month 2: cheaper lesson so gross ($20) < available credit ($30)
    await s.db.from("classes").update({ price_per_lesson: 20 }).eq("id", s.classId);
    const n1 = await s.addSession("2026-08-01"); await s.mark(n1, "present");
    await generateInvoices(s.db, { mode: "manual", force: true, billing_month: "2026-08" });

    const inv = await getInvoice(s.db, s.parentId, "2026-08");
    assertEquals(inv!.gross, 20);
    assertEquals(inv!.credit_applied, 20); // only $20 of the $30 consumed
    assertEquals(inv!.net, 0);
    assertEquals(inv!.status, "paid");
    assertEquals(await s.creditBalance(), 10); // $10 carried forward

    // The note is NOT fully consumed -> stays available (regression for the
    // partial-application ledger bug fixed in 20260711000100_credit_applications).
    const { data: notes } = await s.db
      .from("credit_notes")
      .select("id, status")
      .eq("parent_id", s.parentId);
    assertEquals(notes!.length, 1);
    assertEquals(notes![0].status, "available");

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("result.created surfaces new invoices with line items (for emailing)", async () => {
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2026-03-07"); await s.mark(a, "present");
    const b = await s.addSession("2026-03-14"); await s.mark(b, "present");
    const c = await s.addSession("2026-03-21"); await s.mark(c, "absent");

    const res = await generateInvoices(s.db, {
      mode: "manual",
      force: true,
      billing_month: "2026-03",
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
      mode: "manual",
      force: true,
      billing_month: "2026-03",
    });
    assertEquals(res2.invoices_created, 0);
    assertEquals((res2.created ?? []).length, 0);
  } finally {
    await s.teardown();
  }
});

Deno.test("emailCreatedInvoices: resolves recipients against the DB, no-ops without a key", async () => {
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2026-04-04"); await s.mark(a, "present");
    const res = await generateInvoices(s.db, {
      mode: "manual",
      force: true,
      billing_month: "2026-04",
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
  const s = await newScenario({ price: 30 });
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
    const res = await generateInvoices(s.db, {
      mode: "manual",
      force: true,
      billing_month: "2026-05",
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
