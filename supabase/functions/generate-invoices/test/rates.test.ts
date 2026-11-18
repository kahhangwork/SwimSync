// test/rates.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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

// ============================================================
// Effective-dated class terms (20260719000700 + rates.ts)
//
// These pin the defect that a class's CURRENT price was applied to PAST
// lessons. The first one FAILS on the pre-fix engine — it bills July at the
// August price — which is the point of writing it.
// ============================================================

Deno.test("rates: repricing a class does NOT change an earlier unbilled month", async () => {
  const s = await newScenario({ price: 35, billing: monthEnded("2026-05") });
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
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-05", now: s.now });

    const inv = await getInvoice(s.db, s.parentId, "2026-05", s.tenantId);
    assertEquals(inv!.gross, 70); // 2 x $35, the rate in force in MAY — not 2 x $45
  } finally {
    await s.teardown();
  }
});

Deno.test("rates: a mid-month change splits the invoice at the effective date", async () => {
  const s = await newScenario({ price: 35, billing: monthEnded("2026-07") });
  try {
    const early = await s.addSession("2026-07-04"); await s.mark(early, "present");
    const late  = await s.addSession("2026-07-18"); await s.mark(late,  "present");
    await s.completeMonth("2026-07");

    // Terms change part-way through the month.
    await s.setRate({ from: "2026-07-15", price: 45 });

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07", now: s.now });

    // 4 Jul @ $35 + 18 Jul @ $45 — each lesson at the rate in force on its day.
    const inv = await getInvoice(s.db, s.parentId, "2026-07", s.tenantId);
    assertEquals(inv!.gross, 80);
  } finally {
    await s.teardown();
  }
});

Deno.test("rates: a class with no rate in force refuses to bill, loudly", async () => {
  const s = await newScenario({ price: 35, billing: monthEnded("2026-07") });
  try {
    const j1 = await s.addSession("2026-07-04"); await s.mark(j1, "present");
    await s.completeMonth("2026-07");

    // Break the invariant the floor-dated backfill guarantees. A $0 line, or a
    // silent fall back to classes.price_per_lesson, would be a permanent
    // underbill — the invoice freezes and that lesson can never be rebilled.
    await s.db.from("class_rates").delete().eq("class_id", s.classId);

    await assertRejects(
      () => generateInvoices(s.db, {
        tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07", now: s.now }),
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
  const s = await newScenario({ price: 25, billing: monthEnded("2026-07") });
  try {
    const a = await s.addSession("2026-07-04");
    await s.mark(a, "present");
    await s.completeMonth("2026-07"); // July's other Saturdays rained off

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-07", now: s.now });

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
