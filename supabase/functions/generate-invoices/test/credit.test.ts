// test/credit.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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

Deno.test("credit note is applied FIFO to the next invoice; invariants hold", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  try {
    // Month 1: two present -> invoice $60
    const j1 = await s.addSession("2026-05-02"); await s.mark(j1, "present");
    const j2 = await s.addSession("2026-05-09"); await s.mark(j2, "present");
    await s.completeMonth("2026-05");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-05", now: s.now });

    // Correct an invoiced lesson to absent -> trigger issues a $30 credit note
    await s.mark(j1, "absent");
    assertEquals(await s.creditBalance(), 30);

    // Month 2: two present -> gross $60, $30 credit applied, net $30
    const f1 = await s.addSession("2026-06-06"); await s.mark(f1, "present");
    const f2 = await s.addSession("2026-06-13"); await s.mark(f2, "present");
    await s.completeMonth("2026-06");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06" , now: s.now });

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

Deno.test("carry-forward: credit exceeding the invoice leaves a partial note and reconciles", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-08") });
  try {
    // Month 1: one present @ $30 -> invoice $30
    const m1 = await s.addSession("2026-07-04"); await s.mark(m1, "present");
    await s.completeMonth("2026-07"); // rest of July rained off — keeps gross at $30
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07", now: s.now });

    // Correct -> $30 credit note
    await s.mark(m1, "absent");
    assertEquals(await s.creditBalance(), 30);

    // Month 2: cheaper lesson so gross ($20) < available credit ($30).
    // Via class_rates, dated from the start of August — writing
    // classes.price_per_lesson directly is display-only and would leave July's
    // and August's lessons both at $30 (20260719000700).
    await s.setRate({ from: "2026-08-01", price: 20 });
    const n1 = await s.addSession("2026-08-01"); await s.mark(n1, "present");
    await s.completeMonth("2026-08");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-08", now: s.now });

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

Deno.test("credit_applied records the ACTUAL draw, not the estimate, when balance and notes disagree", async () => {
  // The estimate-vs-truth hole (Item 2, 20260818000200). The engine pre-computes
  // `credit` from the pooled balance and writes it onto the invoice at INSERT. If
  // the balance and the note ledger disagree — exactly what a concurrent reversal
  // produces — the OLD engine left that ESTIMATE on the invoice while the drawdown
  // consumed less. apply_credit_to_invoice now trues credit_applied up to what the
  // notes actually funded, in the same transaction as the draw.
  //
  // RED (§7.25): against the pre-Item-2 engine this asserts 20 but gets 30.
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  try {
    // Month 1: one $20 lesson → correct to absent → a $20 credit note.
    await s.setRate({ from: "2026-05-01", price: 20 });
    const j1 = await s.addSession("2026-05-02"); await s.mark(j1, "present");
    await s.completeMonth("2026-05");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-05", now: s.now });
    await s.mark(j1, "absent");
    assertEquals(await s.creditBalance(), 20);

    // Simulate a stale / over-counted balance: the pool says 30, the notes hold 20.
    await s.db.from("parent_tenant_balances")
      .update({ credit_balance: 30 })
      .eq("parent_id", s.parentId).eq("tenant_id", s.tenantId);

    // Month 2: gross $60. Estimate credit = min(30, 60) = 30; notes only fund 20.
    await s.setRate({ from: "2026-06-01", price: 30 });
    const f1 = await s.addSession("2026-06-06"); await s.mark(f1, "present");
    const f2 = await s.addSession("2026-06-13"); await s.mark(f2, "present");
    await s.completeMonth("2026-06");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06", now: s.now });

    const inv = await getInvoice(s.db, s.parentId, "2026-06");
    assertEquals(inv!.credit_applied, 20); // the TRUTH, not the $30 estimate
    assertEquals(inv!.net, 40);            // 60 − 20, not 60 − 30
    assertEquals(await s.creditBalance(), 10); // 30 − 20 actually drawn
    // No checkInvariants() here: the balance was DELIBERATELY bumped out of step
    // with the notes to force the estimate/truth divergence, so the pool-vs-notes
    // invariant cannot hold — that inconsistency is the scenario, not a bug.
  } finally {
    await s.teardown();
  }
});

Deno.test("debit_balance is folded onto the next invoice: net = gross + debit", async () => {
  // A void-on-paid (20260822000100) leaves the parent owing via debit_balance.
  // The engine must fold that onto their next invoice. RED (§7.25): the pre-
  // migration engine neither reads debit_balance nor sets balance_adjustment.
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  try {
    // Simulate the debit a void-on-paid would have posted.
    await s.db.from("parent_tenant_balances")
      .upsert({ parent_id: s.parentId, tenant_id: s.tenantId, credit_balance: 0, debit_balance: 25 });

    const f1 = await s.addSession("2026-06-06"); await s.mark(f1, "present");
    await s.completeMonth("2026-06");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06", now: s.now });

    const inv = await getInvoice(s.db, s.parentId, "2026-06");
    assertEquals(inv!.gross, 30);
    assertEquals(inv!.balance_adjustment, 25); // the debit folded on
    assertEquals(inv!.credit_applied, 0);
    assertEquals(inv!.net, 55);                 // 30 lessons + 25 carried debit
    assertEquals(inv!.status, "outstanding");

    const { data: bal } = await s.db.from("parent_tenant_balances")
      .select("debit_balance").eq("parent_id", s.parentId).eq("tenant_id", s.tenantId).single();
    assertEquals(Number(bal!.debit_balance), 0); // consumed

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("credit and debit NET on the next invoice (50 credit + 30 debit on a 20 invoice → 0)", async () => {
  // The plan's headline case. A real $50 credit note (from a correction) plus a
  // $30 carried debit, applied to a $20 lesson month → net 0.
  const s = await newScenario({ price: 50, billing: monthEnded("2026-06") });
  try {
    // Month 1: one $50 lesson → invoice → correct to absent → a $50 credit note.
    const j1 = await s.addSession("2026-05-02"); await s.mark(j1, "present");
    await s.completeMonth("2026-05");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-05", now: s.now });
    await s.mark(j1, "absent");
    assertEquals(await s.creditBalance(), 50);

    // Carry a $30 debit (as a void-on-paid elsewhere would leave).
    await s.db.from("parent_tenant_balances")
      .update({ debit_balance: 30 }).eq("parent_id", s.parentId).eq("tenant_id", s.tenantId);

    // Month 2: one $20 lesson.
    await s.setRate({ from: "2026-06-01", price: 20 });
    const f1 = await s.addSession("2026-06-06"); await s.mark(f1, "present");
    await s.completeMonth("2026-06");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-06", now: s.now });

    const inv = await getInvoice(s.db, s.parentId, "2026-06");
    assertEquals(inv!.gross, 20);
    assertEquals(inv!.balance_adjustment, 30);
    assertEquals(inv!.credit_applied, 50);      // full $50 note drawn against 20+30
    assertEquals(inv!.net, 0);                  // 20 + 30 − 50
    assertEquals(inv!.status, "paid");
    assertEquals(await s.creditBalance(), 0);
    const { data: bal } = await s.db.from("parent_tenant_balances")
      .select("debit_balance").eq("parent_id", s.parentId).eq("tenant_id", s.tenantId).single();
    assertEquals(Number(bal!.debit_balance), 0);

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});
