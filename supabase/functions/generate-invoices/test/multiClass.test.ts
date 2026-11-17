// test/multiClass.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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

// ── Multi-class parent ─────────────────────────────────────────────────────
// A parent with children in TWO classes used to be billed for only one: the
// invoice was created during the first class and the "already exists" guard
// skipped them for the second. Engine now tallies across all classes first.

Deno.test("multi-class parent: one invoice covering BOTH classes' lessons", async () => {
  const s = await newScenario({
    price: 30, secondClass: { price: 20 }, billing: monthEnded("2026-09"),
  });
  try {
    const a = await s.addSession("2026-09-05");
    await s.mark(a, "present");
    const b = await s.addSession("2026-09-12", s.classId2);
    await s.mark(b, "present", s.studentId2);
    // BOTH classes must be complete — class 1 is Saturday, class 2 is Sunday.
    await s.completeMonth("2026-09");
    await s.completeMonth("2026-09", s.classId2);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-09",
      now: s.now,
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
  const s = await newScenario({
    price: 30, secondClass: { price: 20 }, billing: monthEnded("2026-10"),
  });
  try {
    const a = await s.addSession("2026-10-03");
    await s.mark(a, "present");
    // Class 2 has a session nobody marked -> that class is incomplete.
    const b = await s.addSession("2026-10-10", s.classId2);
    // Everything ELSE rained off, so the unmarked 10th is the only gap.
    await s.completeMonth("2026-10");
    await s.completeMonth("2026-10", s.classId2);

    // Run 1: NOT forced. The parent has billable items from class 1, but a
    // child in an unmarked class -> bill nothing rather than lock in a
    // partial invoice that tomorrow's retry could never top up.
    const run1 = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2026-10",
      now: s.now,
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
      now: s.now,
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
  const s = await newScenario({
    price: 30, secondClass: { price: 20 }, billing: monthEnded("2026-12"),
  });
  try {
    // Month 1 (class 1 only): $30 invoice, then corrected to absent so the
    // trigger issues a $30 credit note.
    const m1 = await s.addSession("2026-11-07");
    await s.mark(m1, "present");
    await s.completeMonth("2026-11");
    await s.completeMonth("2026-11", s.classId2);
    await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-11",
      now: s.now,
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
    await s.completeMonth("2026-12");
    await s.completeMonth("2026-12", s.classId2);
    await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-12",
      now: s.now,
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
  const s = await newScenario({
    price: 30, secondClass: { price: 20 }, billing: monthEnded("2027-01"),
  });
  try {
    const a = await s.addSession("2027-01-09");
    await s.mark(a, "present");
    const b = await s.addSession("2027-01-16", s.classId2); // unmarked
    // Everything else rained off, so the 16th is the ONLY gap — which is what
    // the blocking assertion below pins.
    await s.completeMonth("2027-01");
    await s.completeMonth("2027-01", s.classId2);

    const blocked = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-01",
      now: s.now,
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
      now: s.now,
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
  const s = await newScenario({ price: 30, billing: monthEnded("2027-02") });
  try {
    await s.addSession("2027-02-06"); // created, deliberately never marked
    // The month's other Saturdays rained off, leaving the 6th as the one gap.
    await s.completeMonth("2027-02");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-02",
      now: s.now,
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
