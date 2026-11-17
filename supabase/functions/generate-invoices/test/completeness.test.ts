// test/completeness.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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

Deno.test("completeness gate: an unmarked lesson blocks BOTH auto and manual", async () => {
  // Was "auto skips it, manual bills it". Manual no longer bypasses the gate:
  // billing around an unmarked lesson gives the parent an invoice that the
  // already-exists guard then stops the missing lesson from ever joining, so
  // the gap becomes a permanent underbill instead of a fixable one.
  const s = await newScenario({ price: 30, billing: monthEnded("2026-04") });
  try {
    const a = await s.addSession("2026-04-04"); await s.mark(a, "present");
    const b = await s.addSession("2026-04-11"); // no attendance -> incomplete
    // April's remaining Saturdays rained off, so the ONLY gap is the 11th —
    // which is what the blocking assertions below pin.
    await s.completeMonth("2026-04");

    const auto = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "auto", billing_month: "2026-04", now: s.now });
    assertEquals(auto.status, "incomplete_attendance");
    assertEquals(auto.invoices_created, 0);

    const man = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-04", now: s.now });
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
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-04", now: s.now });
    assertEquals(ok.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, "2026-04");
    assertEquals(inv!.gross, 30); // the cancelled lesson is non-billable
  } finally {
    await s.teardown();
  }
});

Deno.test("unenrolling a child clears the block their unmarked lesson caused", async () => {
  // The recovery path that makes "no override" survivable: a child who has
  // left with an open enrolment keeps their class permanently incomplete, so
  // without this, billing would be blocked forever with no in-app remedy.
  const s = await newScenario({ price: 30, billing: monthEnded("2027-11") });
  try {
    const a = await s.addSession("2027-11-06"); await s.mark(a, "present");
    const b = await s.addSession("2027-11-13"); // never marked -> blocked
    void b;

    const blocked = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-11",
      now: s.now,
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
      now: s.now,
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
  const s = await newScenario({ price: 30, enrolledAt: "2025-12-01", billing: monthEnded("2026-01") });
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
      billing_month: "2026-01", now: s.now });

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
  const s = await newScenario({ price: 30, enrolledAt: "2025-12-01", billing: monthEnded("2026-01") });
  try {
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: false,
      billing_month: "2026-01", now: s.now });

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
  const s = await newScenario({ price: 30, enrolledAt: "2025-12-01", billing: monthEnded("2026-01") });
  try {
    for (const d of ["2026-01-03", "2026-01-10", "2026-01-17", "2026-01-24"]) {
      const id = await s.addSession(d);
      await s.mark(id, "present");
    }
    const blocked = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual", force: false, billing_month: "2026-01", now: s.now });
    assertEquals(blocked.status, "incomplete_attendance");

    const last = await s.addSession("2026-01-31");
    await s.mark(last, "cancelled_rain");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual", force: false, billing_month: "2026-01", now: s.now });
    assertEquals(res.invoices_created, 1);
    assertEquals((await getInvoice(s.db, s.parentId, "2026-01"))!.gross, 120);
    assert(res.sealed, "a genuinely complete month should seal");
  } finally {
    await s.teardown();
  }
});
