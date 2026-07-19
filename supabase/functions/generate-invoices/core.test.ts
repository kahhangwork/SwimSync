// Integration tests for the billing engine (core.ts) against the local
// Supabase stack. Run with ./test.sh (or export SERVICE_ROLE_KEY first, then
// `deno test --allow-net --allow-env core.test.ts`). Requires `supabase start`.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
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
      tenant_id: s.tenantId,
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
      tenant_id: s.tenantId,
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
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-03" });
    const res2 = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-03" });
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

Deno.test("completeness gate: an unmarked lesson blocks BOTH auto and manual", async () => {
  // Was "auto skips it, manual bills it". Manual no longer bypasses the gate:
  // billing around an unmarked lesson gives the parent an invoice that the
  // already-exists guard then stops the missing lesson from ever joining, so
  // the gap becomes a permanent underbill instead of a fixable one.
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2026-04-04"); await s.mark(a, "present");
    const b = await s.addSession("2026-04-11"); // no attendance -> incomplete

    const auto = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "auto", billing_month: "2026-04" });
    assertEquals(auto.status, "incomplete_attendance");
    assertEquals(auto.invoices_created, 0);

    const man = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-04" });
    assertEquals(man.status, "incomplete_attendance");
    assertEquals(man.invoices_created, 0);
    assertEquals(man.blocking!.length, 1);
    assertEquals(man.blocking![0].session_date, "2026-04-11");
    assertEquals(man.blocking![0].unmarked_student_count, 1);
    assertEquals(await getInvoice(s.db, s.parentId, "2026-04"), null);

    // Marking it — here as "the lesson was rained off" — clears the block and
    // billing proceeds. This is the escape hatch: no override is needed.
    await s.mark(b, "cancelled_rain");
    const ok = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-04" });
    assertEquals(ok.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, "2026-04");
    assertEquals(inv!.gross, 30); // the cancelled lesson is non-billable
  } finally {
    await s.teardown();
  }
});

Deno.test("auto mode honours the auto_invoice_enabled switch", async () => {
  const s = await newScenario();
  try {
    const a = await s.addSession("2026-04-18"); await s.mark(a, "present");
    // The switch is PER TENANT now (was a global app_settings row): one school
    // turning automatic billing off must not turn it off for every other
    // business on the platform.
    await s.db
      .from("tenants")
      .update({ auto_invoice_enabled: false })
      .eq("id", s.tenantId);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "auto", billing_month: "2026-04" });
    assertEquals(res.status, "auto_disabled");
    // early return before any processing
    assertEquals(res.invoices_created, undefined);
    const inv = await getInvoice(s.db, s.parentId, "2026-04");
    assertEquals(inv, null);
  } finally {
    await s.teardown();   // the tenant row goes with it
  }
});

Deno.test("credit note is applied FIFO to the next invoice; invariants hold", async () => {
  const s = await newScenario({ price: 30 });
  try {
    // Month 1: two present -> invoice $60
    const j1 = await s.addSession("2026-05-02"); await s.mark(j1, "present");
    const j2 = await s.addSession("2026-05-09"); await s.mark(j2, "present");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-05" });

    // Correct an invoiced lesson to absent -> trigger issues a $30 credit note
    await s.mark(j1, "absent");
    assertEquals(await s.creditBalance(), 30);

    // Month 2: two present -> gross $60, $30 credit applied, net $30
    const f1 = await s.addSession("2026-06-06"); await s.mark(f1, "present");
    const f2 = await s.addSession("2026-06-13"); await s.mark(f2, "present");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06" });

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
      tenant_id: s.tenantId,
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
    await s.completeMonth("2026-07"); // rest of July rained off — keeps gross at $30
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07" });

    // Correct -> $30 credit note
    await s.mark(m1, "absent");
    assertEquals(await s.creditBalance(), 30);

    // Month 2: cheaper lesson so gross ($20) < available credit ($30).
    // Via class_rates, dated from the start of August — writing
    // classes.price_per_lesson directly is display-only and would leave July's
    // and August's lessons both at $30 (20260719000700).
    await s.setRate({ from: "2026-08-01", price: 20 });
    const n1 = await s.addSession("2026-08-01"); await s.mark(n1, "present");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-08" });

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
      tenant_id: s.tenantId,
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
      tenant_id: s.tenantId,
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
      tenant_id: s.tenantId,
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
      tenant_id: s.tenantId,
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

// ── Multi-class parent ─────────────────────────────────────────────────────
// A parent with children in TWO classes used to be billed for only one: the
// invoice was created during the first class and the "already exists" guard
// skipped them for the second. Engine now tallies across all classes first.

Deno.test("multi-class parent: one invoice covering BOTH classes' lessons", async () => {
  const s = await newScenario({ price: 30, secondClass: { price: 20 } });
  try {
    const a = await s.addSession("2026-09-05");
    await s.mark(a, "present");
    const b = await s.addSession("2026-09-12", s.classId2);
    await s.mark(b, "present", s.studentId2);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-09",
    });

    // Exactly ONE invoice, carrying both classes. Pre-fix this was gross 30
    // with a single line item — the second class silently dropped.
    assertEquals(res.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, "2026-09");
    assertEquals(inv!.gross, 50);
    assertEquals(inv!.net, 50);

    const { data: items } = await s.db
      .from("invoice_items")
      .select("class_title, amount")
      .eq("invoice_id", inv!.id);
    assertEquals(items!.length, 2);
    assertEquals(new Set(items!.map((i) => i.class_title)).size, 2);

    // One CreatedInvoice for the parent, not two — two would double-email
    // (and collide with UNIQUE(parent_id, billing_month)).
    assertEquals(res.created!.length, 1);
    assertEquals(res.created![0].items.length, 2);

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("multi-class parent: auto run defers the parent while any of their classes is unmarked", async () => {
  const s = await newScenario({ price: 30, secondClass: { price: 20 } });
  try {
    const a = await s.addSession("2026-10-03");
    await s.mark(a, "present");
    // Class 2 has a session nobody marked -> that class is incomplete.
    const b = await s.addSession("2026-10-10", s.classId2);

    // Run 1: NOT forced. The parent has billable items from class 1, but a
    // child in an unmarked class -> bill nothing rather than lock in a
    // partial invoice that tomorrow's retry could never top up.
    const run1 = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2026-10",
    });
    assertEquals(run1.invoices_created, 0);
    assertEquals(run1.parents_deferred, 1);
    assert(run1.classes_still_incomplete! >= 1);
    assertEquals(await getInvoice(s.db, s.parentId, "2026-10"), null);

    const { data: sealedEarly } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2026-10")
      .maybeSingle();
    assertEquals(sealedEarly, null); // month must stay open for the retry

    // Coach marks the missing lesson; the retry now bills both classes at once.
    await s.mark(b, "present", s.studentId2);
    const run2 = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2026-10",
    });
    assertEquals(run2.invoices_created, 1);
    assertEquals(run2.parents_deferred, 0);
    assertEquals(run2.classes_still_incomplete, 0);

    const inv = await getInvoice(s.db, s.parentId, "2026-10");
    assertEquals(inv!.gross, 50);

    const { data: sealed } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2026-10")
      .maybeSingle();
    assert(sealed, "fully-marked auto run should seal the month");
  } finally {
    // teardown() does not touch billing_periods, and run 2 seals the month —
    // leaving it would make the NEXT run of this suite hit already_complete.
    await s.db.from("billing_periods").delete().eq("billing_month", "2026-10");
    await s.teardown();
  }
});

Deno.test("multi-class parent: credit draws against the COMBINED gross", async () => {
  const s = await newScenario({ price: 30, secondClass: { price: 20 } });
  try {
    // Month 1 (class 1 only): $30 invoice, then corrected to absent so the
    // trigger issues a $30 credit note.
    const m1 = await s.addSession("2026-11-07");
    await s.mark(m1, "present");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-11",
    });
    await s.mark(m1, "absent");
    assertEquals(await s.creditBalance(), 30);

    // Month 2: both classes -> gross $50. Credit applies to the COMBINED
    // gross, leaving $20 outstanding. Pre-fix, gross was $30 and the $30
    // credit covered it exactly, wrongly marking the invoice PAID.
    const c1 = await s.addSession("2026-12-05");
    await s.mark(c1, "present");
    const c2 = await s.addSession("2026-12-12", s.classId2);
    await s.mark(c2, "present", s.studentId2);
    await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-12",
    });

    const inv = await getInvoice(s.db, s.parentId, "2026-12");
    assertEquals(inv!.gross, 50);
    assertEquals(inv!.credit_applied, 30);
    assertEquals(inv!.net, 20);
    assertEquals(inv!.status, "outstanding");
    assertEquals(await s.creditBalance(), 0);

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("multi-class parent: force does NOT bypass the block; marking clears it", async () => {
  // The admin panel's path (force: true). One class marked, the other not:
  // nothing may be billed, because invoicing the complete class would strand
  // the other class's lessons behind the already-exists guard forever.
  const s = await newScenario({ price: 30, secondClass: { price: 20 } });
  try {
    const a = await s.addSession("2027-01-09");
    await s.mark(a, "present");
    const b = await s.addSession("2027-01-16", s.classId2); // unmarked

    const blocked = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-01",
    });
    assertEquals(blocked.status, "incomplete_attendance");
    assertEquals(blocked.invoices_created, 0);
    assertEquals(await getInvoice(s.db, s.parentId, "2027-01"), null);
    assertEquals(blocked.blocking![0].session_date, "2027-01-16");

    // Mark the outstanding lesson: the same run now bills BOTH classes on one
    // invoice.
    await s.mark(b, "present", s.studentId2);
    const ok = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-01",
    });
    assertEquals(ok.invoices_created, 1);
    assertEquals(ok.parents_deferred, 0);

    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assertEquals(inv!.gross, 50);
    assertEquals(inv!.status, "outstanding");
  } finally {
    await s.teardown();
  }
});

Deno.test("deferral is reported even when NO class was tallied", async () => {
  // Regression: parents_deferred used to be counted inside the phase-2 loop,
  // which only visits parents who have billable items. When every class is
  // incomplete nothing is tallied at all, so the count came back 0 while the
  // entire month was blocked — reporting silence for the loudest case.
  const s = await newScenario({ price: 30 });
  try {
    await s.addSession("2027-02-06"); // created, deliberately never marked

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-02",
    });

    assertEquals(res.status, "incomplete_attendance");
    assertEquals(res.invoices_created, 0);
    // Counted from the deferred SET, not the phase-2 loop — that loop only
    // visits parents with billable items, and here nothing was tallied at all.
    assertEquals(res.parents_deferred, 1);
    assertEquals(res.blocking!.length, 1);
    assertEquals(res.blocking![0].unmarked_student_count, 1);
  } finally {
    await s.teardown();
  }
});

// ── Configurable run day ───────────────────────────────────────────────────
// The automatic path waits until app_settings.invoice_run_day. Manual runs
// ignore it entirely. `now` is injected so these do not depend on the actual
// day of the month.

Deno.test("run day: auto run before the configured day generates nothing", async () => {
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-03-06"); await s.mark(a, "present");

    // 3 April, run day 7 -> too early.
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-03",
      now: new Date("2027-04-03T02:00:00Z"),
    });

    assertEquals(res.status, "before_run_day");
    assertEquals(await getInvoice(s.db, s.parentId, "2027-03"), null);

    const { data: sealed } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2027-03")
      .maybeSingle();
    assertEquals(sealed, null); // must not seal a month it declined to bill
  } finally {
    await s.teardown();
  }
});

Deno.test("run day: auto run on the configured day generates normally", async () => {
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-04-03"); await s.mark(a, "present");
    await s.completeMonth("2027-04", undefined, new Date("2027-05-07T02:00:00Z")); // the month's other Saturdays rained off

    // 7 May, run day 7 -> due today (boundary: >= not >).
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-04",
      now: new Date("2027-05-07T02:00:00Z"),
    });

    assertEquals(res.invoices_created, 1);
    assertEquals((await getInvoice(s.db, s.parentId, "2027-04"))!.gross, 30);
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-04");
    await s.teardown();
  }
});

Deno.test("run day: a MANUAL run before the day generates anyway", async () => {
  // The admin pressing Generate is an explicit instruction — a schedule meant
  // for the unattended cron must never block it.
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-05-01"); await s.mark(a, "present");
    await s.completeMonth("2027-05", undefined, new Date("2027-06-01T02:00:00Z"));

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-05",
      now: new Date("2027-06-01T02:00:00Z"), // day 1, well before day 7
    });

    assertEquals(res.invoices_created, 1);
    assertEquals((await getInvoice(s.db, s.parentId, "2027-05"))!.gross, 30);
  } finally {
    await s.teardown();
  }
});

Deno.test("run day: honours a changed setting, and SGT decides the day", async () => {
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-06-05"); await s.mark(a, "present");
    await s.completeMonth("2027-06", undefined, new Date("2027-07-14T17:00:00Z"));
    await s.db
      .from("app_settings")
      .update({ value: 15 })
      .eq("key", "invoice_run_day");

    // Day 14 in SGT -> still too early for a run day of 15.
    const early = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-06",
      now: new Date("2027-07-14T02:00:00Z"),
    });
    assertEquals(early.status, "before_run_day");

    // 14 Jul 17:00 UTC is already the 15th in Singapore — the guard must read
    // the SGT day, not the UTC one, or it fires a day late every month.
    const due = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-06",
      now: new Date("2027-07-14T17:00:00Z"),
    });
    assertEquals(due.invoices_created, 1);
  } finally {
    await s.db
      .from("app_settings")
      .update({ value: 7 })
      .eq("key", "invoice_run_day");
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-06");
    await s.teardown();
  }
});

// ── Sealing a finished month ───────────────────────────────────────────────
// Once every parent is invoiced, nothing further should happen for that month
// — whether it was finished by an early manual run or by the cron.

Deno.test("seal: a MANUAL run that finishes the month seals it; cron then no-ops", async () => {
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-07-03"); await s.mark(a, "present");

    const manual = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-07",
    });
    assertEquals(manual.invoices_created, 1);
    assertEquals(manual.sealed, true);
    assertEquals(manual.classes_still_incomplete, 0);

    const { data: period } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2027-07")
      .maybeSingle();
    assert(period, "a completed manual run should seal the month");

    // The whole point: the scheduled run now has nothing to do.
    const cron = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-07",
      now: new Date("2027-08-07T02:00:00Z"),
    });
    assertEquals(cron.status, "already_complete");
    assertEquals(cron.invoices_created, undefined); // returned before any work
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-07");
    await s.teardown();
  }
});

Deno.test("seal: a forced run on an INCOMPLETE month bills nothing and seals nothing", async () => {
  // The safety property. Sealing here would lock the unmarked lesson out
  // permanently. Since the block landed, a forced run on an incomplete month
  // bills nothing at all — but it must still MEASURE the incompleteness, or a
  // later change to the block would silently make sealing unsafe.
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-08-07"); await s.mark(a, "present");
    await s.addSession("2027-08-14"); // left unmarked -> class incomplete

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-08",
    });

    assertEquals(res.status, "incomplete_attendance");
    assertEquals(res.invoices_created, 0);
    assertEquals(res.sealed, false);
    assert(
      res.classes_still_incomplete! >= 1,
      "forced runs must still MEASURE incompleteness, or sealing is unsafe"
    );

    const { data: period } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2027-08")
      .maybeSingle();
    assertEquals(period, null);
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-08");
    await s.teardown();
  }
});

Deno.test("seal: a month with NOTHING recorded is never sealed", async () => {
  // The vacuous-seal bug, hit in production 2026-07-18: generation was run on a
  // month with nothing marked, reported "0 invoices", and SEALED it — after
  // which every later run short-circuited on already_complete and the month
  // could never be billed. The three original seal conditions (no incomplete
  // class, no deferred parent, no failed write) are all trivially true when the
  // run found nothing, so "nothing happened" was indistinguishable from
  // "everything is finished".
  //
  // Note this is the ORDINARY state of a month nobody has marked yet: sessions
  // are created lazily by attendance marking, so an unmarked month has no
  // lesson_sessions at all — not merely no classes.
  const s = await newScenario({ price: 30 });
  try {
    // A class and an enrolled student exist, but no session in the month.
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-11",
    });

    assertEquals(res.invoices_created, 0);
    assertEquals(res.sealed, false);
    assertEquals(res.status, "nothing_to_bill");
    assertStringIncludes(res.message ?? "", "left OPEN");

    const { data: period } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2027-11")
      .maybeSingle();
    assertEquals(period, null, "an empty month must not be sealed");

    // The property that actually matters: the month is still billable. Mark a
    // lesson and the ordinary run works — which the seal would have prevented.
    const a = await s.addSession("2027-11-06");
    await s.mark(a, "present");
    const after = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2027-11",
    });
    assertEquals(after.invoices_created, 1);
    assertEquals(after.sealed, true);
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-11");
    await s.teardown();
  }
});

Deno.test("seal: a fully-marked month with NO billable lesson still seals", async () => {
  // The other side of the guard above: a month where every lesson was rained
  // off is genuinely finished and yields no invoice. It must still seal, or the
  // fix would trade a stuck-closed month for a never-closing one.
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-12-04");
    await s.mark(a, "cancelled_rain");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2027-12",
    });

    assertEquals(res.invoices_created, 0);
    assertEquals(res.sealed, true, "a complete month with no billable lesson is still finished");
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-12");
    await s.teardown();
  }
});

Deno.test("seal: sealing twice is a no-op, not a duplicate-key error", async () => {
  // A forced run bypasses the sealed-month guard, so the seal can be reached
  // a second time for the same month.
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-09-04"); await s.mark(a, "present");

    const first = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-09",
    });
    assertEquals(first.sealed, true);
    assertEquals(first.invoices_created, 1);

    const second = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-09",
    });
    assertEquals(second.sealed, true);
    assertEquals(second.invoices_created, 0); // already_exists guard held

    const { count } = await s.db
      .from("billing_periods")
      .select("billing_month", { count: "exact", head: true })
      .eq("billing_month", "2027-09");
    assertEquals(count, 1);
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-09");
    await s.teardown();
  }
});

// ── Billing follows attendance, not current enrolment ──────────────────────

Deno.test("a child unenrolled mid-month is still billed for lessons they attended", async () => {
  // The trap behind the new "remove from class" action. Billing used to build
  // its student list from ACTIVE enrolments, so closing an enrolment silently
  // dropped that child's already-attended lessons from the invoice — one tap
  // would have cost a month's revenue for them. Who must be MARKED still comes
  // from enrolments; who gets BILLED now comes from the attendance rows.
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-10-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-10-09"); await s.mark(b, "present");

    // The family leaves mid-month: enrolment closed, history kept.
    await s.db
      .from("student_class_enrolments")
      .update({ is_active: false, unenrolled_at: new Date().toISOString() })
      .eq("student_id", s.studentId);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-10",
    });

    assertEquals(res.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, "2027-10");
    assertEquals(inv!.gross, 60); // both attended lessons, not 0
    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("unenrolling a child clears the block their unmarked lesson caused", async () => {
  // The recovery path that makes "no override" survivable: a child who has
  // left with an open enrolment keeps their class permanently incomplete, so
  // without this, billing would be blocked forever with no in-app remedy.
  const s = await newScenario({ price: 30 });
  try {
    const a = await s.addSession("2027-11-06"); await s.mark(a, "present");
    const b = await s.addSession("2027-11-13"); // never marked -> blocked
    void b;

    const blocked = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-11",
    });
    assertEquals(blocked.status, "incomplete_attendance");

    // Close the enrolment: nobody is expected to be marked any more.
    await s.db
      .from("student_class_enrolments")
      .update({ is_active: false, unenrolled_at: new Date().toISOString() })
      .eq("student_id", s.studentId);

    const ok = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-11",
    });
    assertEquals(ok.status, "complete — billing month sealed");
    assertEquals(ok.invoices_created, 1);
    // Still billed for the lesson they DID attend.
    assertEquals((await getInvoice(s.db, s.parentId, "2027-11"))!.gross, 30);
  } finally {
    await s.teardown();
  }
});

// ── The expected-vs-existing gate ───────────────────────────────────────────
// The engine's completeness gate only ever looked at lesson_sessions rows that
// EXIST. A lesson nobody touched at all has no session row (they are created
// lazily by attendance marking, PRD §7.5), so it was invisible to the gate: the
// run billed the marked lessons, reported the month complete, and sealed it —
// and the unmarked lesson can never be added afterwards (§11.6).
//
// This is the exact underbill PRD §7.7's block exists to prevent. It was caught
// only by computeClassCoverage() in the ADMIN UI, which derives expected dates
// from the class weekday. The server never did, so the only effective gate was
// client-side — the inverse of gotcha §7.8.
Deno.test("BLOCKS a lesson date that has no session row at all", async () => {
  // Saturdays in Jan 2026: 3, 10, 17, 24, 31. Enrolment predates the month, so
  // all five are expected lessons.
  const s = await newScenario({ price: 30, enrolledAt: "2025-12-01" });
  try {
    for (const d of ["2026-01-03", "2026-01-10", "2026-01-17", "2026-01-24"]) {
      const id = await s.addSession(d);
      await s.mark(id, "present");
    }
    // 2026-01-31 is deliberately never touched: no session row, no attendance.

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: false,
      billing_month: "2026-01",
    });

    assertEquals(res.status, "incomplete_attendance");
    assertEquals(res.invoices_created, 0);
    assert(
      (res.blocking ?? []).some((b) => b.session_date === "2026-01-31"),
      `expected 2026-01-31 to block; got ${JSON.stringify(res.blocking)}`
    );
    assertEquals(await getInvoice(s.db, s.parentId, "2026-01"), null);
  } finally {
    await s.teardown();
  }
});

Deno.test("BLOCKS a class whose whole month is unmarked (no sessions at all)", async () => {
  // The worst shape: not a partial gap but a class nobody touched all month.
  // The old gate `continue`d on zero sessions, so if ANY other class was
  // complete the month could seal with this class entirely unbilled.
  const s = await newScenario({ price: 30, enrolledAt: "2025-12-01" });
  try {
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: false,
      billing_month: "2026-01",
    });

    assertEquals(res.status, "incomplete_attendance");
    assertEquals(res.invoices_created, 0);
    // All five January Saturdays are outstanding.
    assertEquals(
      (res.blocking ?? []).filter((b) => b.class_id === s.classId).length,
      5
    );
  } finally {
    await s.teardown();
  }
});

Deno.test("marking the missing lesson cancelled clears the block and bills the rest", async () => {
  // The documented escape hatch (PRD §7.7): a lesson that did not run is
  // recorded cancelled, which satisfies the gate without billing anyone.
  const s = await newScenario({ price: 30, enrolledAt: "2025-12-01" });
  try {
    for (const d of ["2026-01-03", "2026-01-10", "2026-01-17", "2026-01-24"]) {
      const id = await s.addSession(d);
      await s.mark(id, "present");
    }
    const blocked = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual", force: false, billing_month: "2026-01",
    });
    assertEquals(blocked.status, "incomplete_attendance");

    const last = await s.addSession("2026-01-31");
    await s.mark(last, "cancelled_rain");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual", force: false, billing_month: "2026-01",
    });
    assertEquals(res.invoices_created, 1);
    assertEquals((await getInvoice(s.db, s.parentId, "2026-01"))!.gross, 120);
    assert(res.sealed, "a genuinely complete month should seal");
  } finally {
    await s.teardown();
  }
});

Deno.test("a future lesson in the CURRENT month is not a gap", async () => {
  // The window clamps to today: billing an in-progress month must not block on
  // lessons that have not happened yet.
  const now = new Date("2026-01-15T02:00:00Z"); // Thu 15 Jan, SGT
  const s = await newScenario({ price: 30, enrolledAt: "2025-12-01" });
  try {
    // Saturdays up to the 15th: 3, 10. The 17/24/31 are still in the future.
    for (const d of ["2026-01-03", "2026-01-10"]) {
      const id = await s.addSession(d);
      await s.mark(id, "present");
    }

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual", force: false, billing_month: "2026-01", now,
    });
    assertEquals(res.invoices_created, 1);
    assertEquals((await getInvoice(s.db, s.parentId, "2026-01"))!.gross, 60);
  } finally {
    await s.teardown();
  }
});

// ── Tenant isolation in BILLING ─────────────────────────────────────────────
// The engine runs with the service-role key, which BYPASSES RLS entirely — so
// none of the phase-1 policies protect this path. Isolation here is enforced by
// explicit tenant_id filters in core.ts, and these are the tests that prove it.
// Each fails on a build where any one of those filters is missing.

Deno.test("two tenants bill independently; neither sees the other's lessons", async () => {
  const a = await newScenario({ price: 30 });
  const b = await newScenario({ price: 50 });
  try {
    const sa = await a.addSession("2026-09-05"); await a.mark(sa, "present");
    await a.completeMonth("2026-09");
    const sb = await b.addSession("2026-09-06"); await b.mark(sb, "present");
    await b.completeMonth("2026-09");

    const resA = await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: false, billing_month: "2026-09" });
    assertEquals(resA.invoices_created, 1);
    assertEquals((await getInvoice(a.db, a.parentId, "2026-09"))!.gross, 30);

    const resB = await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: false, billing_month: "2026-09" });
    assertEquals(resB.invoices_created, 1);
    assertEquals((await getInvoice(b.db, b.parentId, "2026-09"))!.gross, 50);
  } finally {
    await a.teardown(); await b.teardown();
  }
});

Deno.test("sealing one tenant's month does NOT seal it for another", async () => {
  // billing_periods used to be keyed by billing_month alone, so the first
  // business to finish a month closed it for everyone — every other tenant then
  // short-circuited on already_complete and silently billed nothing.
  const a = await newScenario({ price: 30 });
  const b = await newScenario({ price: 40 });
  try {
    const sa = await a.addSession("2026-10-03"); await a.mark(sa, "present");
    await a.completeMonth("2026-10");
    const resA = await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: false, billing_month: "2026-10" });
    assert(resA.sealed, "tenant A's completed month should seal");

    const sb = await b.addSession("2026-10-03"); await b.mark(sb, "present");
    await b.completeMonth("2026-10");
    const resB = await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: false, billing_month: "2026-10" });

    assertEquals(resB.status !== "already_complete", true,
      `tenant B was blocked by tenant A's seal: ${resB.status}`);
    assertEquals(resB.invoices_created, 1);
  } finally {
    await a.teardown(); await b.teardown();
  }
});

Deno.test("one tenant's unmarked lesson does not block another's billing", async () => {
  const a = await newScenario({ price: 30, enrolledAt: "2025-12-01" }); // will be blocked
  const b = await newScenario({ price: 40 });
  try {
    // Tenant A: a January Saturday with no session at all.
    const sa = await a.addSession("2026-01-03"); await a.mark(sa, "present");

    const sb = await b.addSession("2026-01-10"); await b.mark(sb, "present");
    await b.completeMonth("2026-01");

    const resA = await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: false, billing_month: "2026-01" });
    assertEquals(resA.status, "incomplete_attendance");

    const resB = await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: false, billing_month: "2026-01" });
    assertEquals(resB.invoices_created, 1, "tenant B must bill despite tenant A being blocked");
  } finally {
    await a.teardown(); await b.teardown();
  }
});

Deno.test("credit earned in one tenant is NOT spendable in another", async () => {
  // The money-model invariant. Drawing a school's credit note against a private
  // coach's invoice would move cash between two unrelated businesses.
  const a = await newScenario({ price: 30 });
  const b = await newScenario({ price: 30 });
  try {
    // Tenant A: bill, then correct to absent -> $30 credit with tenant A.
    const s1 = await a.addSession("2026-11-07"); await a.mark(s1, "present");
    await a.completeMonth("2026-11");
    await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: true, billing_month: "2026-11" });
    await a.mark(s1, "absent");
    assertEquals(await a.tenantCreditBalance(), 30);

    // Same PARENT also deals with tenant B: link them and give them a lesson.
    await b.db.from("parent_tenants")
      .insert({ parent_id: a.parentId, tenant_id: b.tenantId });
    const stu = await b.db.from("students")
      .insert({ full_name: "Cross Kid", assignment_status: "assigned", tenant_id: b.tenantId })
      .select("id").single();
    await b.db.from("parent_students")
      .insert({ parent_id: a.parentId, student_id: stu.data!.id });
    await b.db.from("student_class_enrolments")
      .insert({ student_id: stu.data!.id, class_id: b.classId, is_active: true });

    const s2 = await b.addSession("2026-11-07");
    await b.mark(s2, "present", stu.data!.id);
    await b.mark(s2, "cancelled_rain");     // b's own child, same session
    await b.completeMonth("2026-11");

    const resB = await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: true, billing_month: "2026-11" });
    assertEquals(resB.invoices_created, 1);

    // Tenant B's invoice must be billed in FULL — tenant A's credit is not theirs.
    const invB = await getInvoice(b.db, a.parentId, "2026-11", b.tenantId);
    assertEquals(invB!.gross, 30);
    assertEquals(invB!.credit_applied, 0, "tenant A's credit must not touch tenant B's invoice");
    assertEquals(invB!.net, 30);
    // And A's credit is untouched, still waiting for A's next invoice.
    assertEquals(await a.tenantCreditBalance(), 30);
  } finally {
    await b.db.from("parent_tenants").delete().eq("parent_id", a.parentId);
    await b.teardown(); await a.teardown();
  }
});

Deno.test("a parent with children in TWO tenants gets TWO invoices that month", async () => {
  // The user's expected COMMON case (multiple kids, multiple private coaches).
  // UNIQUE (parent_id, billing_month) forbade it outright.
  const a = await newScenario({ price: 30 });
  const b = await newScenario({ price: 45 });
  try {
    const s1 = await a.addSession("2026-12-05"); await a.mark(s1, "present");
    await a.completeMonth("2026-12");

    await b.db.from("parent_tenants")
      .insert({ parent_id: a.parentId, tenant_id: b.tenantId });
    const stu = await b.db.from("students")
      .insert({ full_name: "Sibling", assignment_status: "assigned", tenant_id: b.tenantId })
      .select("id").single();
    await b.db.from("parent_students")
      .insert({ parent_id: a.parentId, student_id: stu.data!.id });
    await b.db.from("student_class_enrolments")
      .insert({ student_id: stu.data!.id, class_id: b.classId, is_active: true });
    const s2 = await b.addSession("2026-12-06");
    await b.mark(s2, "present", stu.data!.id);
    await b.mark(s2, "cancelled_rain");     // b's own child, same session
    await b.completeMonth("2026-12");

    await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: true, billing_month: "2026-12" });
    await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: true, billing_month: "2026-12" });

    const { data: invs } = await a.db
      .from("invoices")
      .select("tenant_id, gross_amount")
      .eq("parent_id", a.parentId)
      .eq("billing_month", "2026-12");

    assertEquals(invs!.length, 2, "one invoice per business, not one in total");
    const byTenant = Object.fromEntries(
      invs!.map((i) => [i.tenant_id, Number(i.gross_amount)])
    );
    assertEquals(byTenant[a.tenantId], 30);
    assertEquals(byTenant[b.tenantId], 45);
  } finally {
    await b.db.from("parent_tenants").delete().eq("parent_id", a.parentId);
    await b.teardown(); await a.teardown();
  }
});

Deno.test("credit note references are numbered PER TENANT, both from 0001", async () => {
  // A global sequence made a school's third note read CN-2026-0047, and the
  // gaps told them exactly how many notes every other business had issued in
  // between. Each tenant now numbers its own.
  const a = await newScenario({ price: 30 });
  const b = await newScenario({ price: 30 });
  try {
    for (const s of [a, b]) {
      const sess = await s.addSession("2027-02-06");
      await s.mark(sess, "present");
      await s.completeMonth("2027-02");
      await generateInvoices(s.db, {
        tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2027-02" });
      await s.mark(sess, "absent"); // -> credit note
    }

    const refFor = async (s: typeof a) => {
      const { data } = await s.db
        .from("credit_notes")
        .select("reference_number")
        .eq("tenant_id", s.tenantId)
        .single();
      return data!.reference_number as string;
    };

    const refA = await refFor(a);
    const refB = await refFor(b);

    // Both are their tenant's FIRST note, so both end 0001 — which a global
    // UNIQUE on reference_number would have rejected outright.
    assert(refA.endsWith("-0001"), `tenant A got ${refA}`);
    assert(refB.endsWith("-0001"), `tenant B got ${refB}`);
  } finally {
    await a.teardown(); await b.teardown();
  }
});

// ============================================================
// Effective-dated class terms (20260719000700 + rates.ts)
//
// These pin the defect that a class's CURRENT price was applied to PAST
// lessons. The first one FAILS on the pre-fix engine — it bills July at the
// August price — which is the point of writing it.
// ============================================================

Deno.test("rates: repricing a class does NOT change an earlier unbilled month", async () => {
  const s = await newScenario({ price: 35 });
  try {
    // Two MAY lessons taught at $35, not yet invoiced.
    const m1 = await s.addSession("2026-05-02"); await s.mark(m1, "present");
    const m2 = await s.addSession("2026-05-09"); await s.mark(m2, "present");
    await s.completeMonth("2026-05");

    // The price rises to $45 from 1 June — AFTER those lessons were taught but
    // BEFORE May is invoiced. That is the window the old engine was exposed to:
    // it priced at generation time, so May would have billed at $45.
    //
    // The effective date must be in the PAST relative to the test clock, or
    // this test silently proves nothing: the display-sync trigger only tracks
    // rates already in force, so a future-dated change leaves
    // classes.price_per_lesson untouched and the OLD engine reads the right
    // number by accident. Verified to fail on the pre-fix engine.
    await s.setRate({ from: "2026-06-01", price: 45 });

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-05" });

    const inv = await getInvoice(s.db, s.parentId, "2026-05", s.tenantId);
    assertEquals(inv!.gross, 70); // 2 x $35, the rate in force in MAY — not 2 x $45
  } finally {
    await s.teardown();
  }
});

Deno.test("rates: a mid-month change splits the invoice at the effective date", async () => {
  const s = await newScenario({ price: 35 });
  try {
    const early = await s.addSession("2026-07-04"); await s.mark(early, "present");
    const late  = await s.addSession("2026-07-18"); await s.mark(late,  "present");
    await s.completeMonth("2026-07");

    // Terms change part-way through the month.
    await s.setRate({ from: "2026-07-15", price: 45 });

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07" });

    // 4 Jul @ $35 + 18 Jul @ $45 — each lesson at the rate in force on its day.
    const inv = await getInvoice(s.db, s.parentId, "2026-07", s.tenantId);
    assertEquals(inv!.gross, 80);
  } finally {
    await s.teardown();
  }
});

Deno.test("rates: a class with no rate in force refuses to bill, loudly", async () => {
  const s = await newScenario({ price: 35 });
  try {
    const j1 = await s.addSession("2026-07-04"); await s.mark(j1, "present");
    await s.completeMonth("2026-07");

    // Break the invariant the floor-dated backfill guarantees. A $0 line, or a
    // silent fall back to classes.price_per_lesson, would be a permanent
    // underbill — the invoice freezes and that lesson can never be rebilled.
    await s.db.from("class_rates").delete().eq("class_id", s.classId);

    await assertRejects(
      () => generateInvoices(s.db, {
        tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07" }),
      Error,
      "No class rate in force",
    );

    // Nothing was written: refusing must leave no partial invoice behind.
    const inv = await getInvoice(s.db, s.parentId, "2026-07", s.tenantId);
    assertEquals(inv, null);
  } finally {
    await s.teardown();
  }
});

// ── The invoice records the name it was ISSUED with ─────────────────────────
// An invoice is a document that gets sent. Reading the student's name live at
// display time meant a later rename silently rewrote invoices already in a
// parent's hands — the same class of bug as reading classes.price_per_lesson at
// generation time, and the reason class_title is snapshotted beside it.
Deno.test("invoice_items snapshots the student name, and a rename cannot rewrite it", async () => {
  const s = await newScenario({ price: 25 });
  try {
    const a = await s.addSession("2026-07-04");
    await s.mark(a, "present");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07",
    });

    const inv = await getInvoice(s.db, s.parentId, "2026-07", s.tenantId);
    const { data: before } = await s.db
      .from("invoice_items")
      .select("student_name")
      .eq("invoice_id", inv!.id);

    // The engine wrote a name at all — without this the rest passes vacuously
    // on a NULL column (§7.17: ask what the check does when nothing happened).
    assertEquals(before!.length, 1);
    assert(
      before![0].student_name && before![0].student_name.startsWith("Kid "),
      `expected a snapshotted name, got ${JSON.stringify(before![0].student_name)}`,
    );
    const invoicedAs = before![0].student_name;

    // An ordinary correction: the family supplies the child's full legal name.
    await s.db
      .from("students")
      .update({ full_name: "Renamed Entirely" })
      .eq("id", s.studentId);

    const { data: after } = await s.db
      .from("invoice_items")
      .select("student_name")
      .eq("invoice_id", inv!.id);

    assertEquals(after![0].student_name, invoicedAs);
    assert(
      after![0].student_name !== "Renamed Entirely",
      "the rename reached back into an already-issued invoice",
    );
  } finally {
    await s.teardown();
  }
});
