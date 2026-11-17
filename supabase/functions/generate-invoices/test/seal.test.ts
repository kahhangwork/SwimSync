// test/seal.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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

// ── Sealing a finished month ───────────────────────────────────────────────
// Once every parent is invoiced, nothing further should happen for that month
// — whether it was finished by an early manual run or by the cron.

Deno.test("seal: a MANUAL run that finishes the month seals it; cron then no-ops", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-07") });
  try {
    const a = await s.addSession("2027-07-03"); await s.mark(a, "present");
    await s.completeMonth("2027-07"); // the month must be FINISHED to seal

    const manual = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-07",
      now: s.now,
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
  const s = await newScenario({ price: 30, billing: monthEnded("2027-08") });
  try {
    const a = await s.addSession("2027-08-07"); await s.mark(a, "present");
    await s.addSession("2027-08-14"); // left unmarked -> class incomplete
    await s.completeMonth("2027-08"); // everything else accounted for

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-08",
      now: s.now,
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

Deno.test("seal: a month nobody marked is BLOCKED, and never sealed", async () => {
  // The vacuous-seal bug, hit in production 2026-07-18: generation was run on a
  // month with nothing marked, reported "0 invoices", and SEALED it — after
  // which every later run short-circuited on already_complete and the month
  // could never be billed. The three original seal conditions (no incomplete
  // class, no deferred parent, no failed write) are all trivially true when the
  // run found nothing, so "nothing happened" was indistinguishable from
  // "everything is finished".
  //
  // This is the ORDINARY state of a month nobody has marked: sessions are
  // created lazily by attendance marking (PRD §7.5), so an unmarked month has
  // no lesson_sessions at all.
  //
  // STATUS CHANGED when the test clock was corrected. This test used to assert
  // `nothing_to_bill`, but only because it ran against the REAL clock with a
  // billing month in the future — so no lessons were expected and the engine
  // genuinely saw nothing. At a clock where the month has actually ended, the
  // class HAS four expected Saturdays with no sessions, so the honest answer is
  // `incomplete_attendance`, which additionally NAMES the missing lessons. The
  // safety property under test is unchanged and is what matters: the month is
  // not sealed and stays billable.
  const s = await newScenario({ price: 30, billing: monthEnded("2027-11") });
  try {
    // A class and an enrolled student exist, but no session in the month.
    // Deliberately NOT completed — "nobody marked anything" is the whole point.
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-11",
      now: s.now,
    });

    assertEquals(res.invoices_created, 0);
    assertEquals(res.sealed, false);
    assertEquals(res.status, "incomplete_attendance");
    // Every Saturday in Nov 2027 (7th, 14th, 21st, 28th) is outstanding.
    assertEquals((res.blocking ?? []).length, 4);

    const { data: period } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2027-11")
      .eq("tenant_id", s.tenantId)
      .maybeSingle();
    assertEquals(period, null, "an unmarked month must not be sealed");

    // The property that actually matters: the month is still billable. Mark the
    // lessons and the ordinary run works — which the seal would have prevented.
    const a = await s.addSession("2027-11-06");
    await s.mark(a, "present");
    await s.completeMonth("2027-11");
    const after = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2027-11",
      now: s.now,
    });
    assertEquals(after.invoices_created, 1);
    assertEquals(after.sealed, true);
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-11");
    await s.teardown();
  }
});

Deno.test("seal: a month with genuinely NOTHING DUE reports nothing_to_bill and stays open", async () => {
  // The other half of the vacuous-seal guard, and the case that still reaches
  // `nothing_to_bill` now that the clock is honest: not "nobody marked the
  // lessons" (above — that BLOCKS) but "no lesson was ever due". A tenant whose
  // only student is no longer enrolled expects nothing, so there is nothing to
  // reckon with — and a run that reckoned with nothing must not close the month.
  const s = await newScenario({ price: 30, billing: monthEnded("2027-03") });
  try {
    // Close the enrolment: no active student, so no lesson is expected at all.
    await s.db
      .from("student_class_enrolments")
      .update({ is_active: false, unenrolled_at: new Date().toISOString() })
      .eq("student_id", s.studentId);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-03",
      now: s.now,
    });

    assertEquals(res.invoices_created, 0);
    assertEquals(res.sealed, false);
    assertEquals(res.status, "nothing_to_bill");
    assertStringIncludes(res.message ?? "", "left OPEN");

    const { data: period } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2027-03")
      .eq("tenant_id", s.tenantId)
      .maybeSingle();
    assertEquals(period, null, "a month that reckoned with nothing must not seal");
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-03");
    await s.teardown();
  }
});

Deno.test("seal: a fully-marked month with NO billable lesson still seals", async () => {
  // The other side of the guard above: a month where every lesson was rained
  // off is genuinely finished and yields no invoice. It must still seal, or the
  // fix would trade a stuck-closed month for a never-closing one.
  const s = await newScenario({ price: 30, billing: monthEnded("2027-12") });
  try {
    const a = await s.addSession("2027-12-04");
    await s.mark(a, "cancelled_rain");
    await s.completeMonth("2027-12"); // every lesson rained off — finished, no money

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2027-12",
      now: s.now,
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
  const s = await newScenario({ price: 30, billing: monthEnded("2027-09") });
  try {
    const a = await s.addSession("2027-09-04"); await s.mark(a, "present");
    await s.completeMonth("2027-09");

    const first = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-09",
      now: s.now,
    });
    assertEquals(first.sealed, true);
    assertEquals(first.invoices_created, 1);

    const second = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-09",
      now: s.now,
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
