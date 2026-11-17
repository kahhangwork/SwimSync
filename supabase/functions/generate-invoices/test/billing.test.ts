// test/billing.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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

Deno.test("bills only billable attendance; gross = sum of billable rates", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-01") });
  try {
    const a = await s.addSession("2026-01-03"); await s.mark(a, "present");
    const b = await s.addSession("2026-01-10"); await s.mark(b, "present");
    const c = await s.addSession("2026-01-17"); await s.mark(c, "absent");
    const d = await s.addSession("2026-01-24"); await s.mark(d, "trial_free");
    // January has a FIFTH Saturday (the 31st). Leaving it unmarked is an
    // incomplete month and is correctly blocked, so rain it off — non-billable,
    // so gross is unchanged.
    await s.completeMonth("2026-01");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-01",
      now: s.now,
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
  const s = await newScenario({ price: 25, billing: monthEnded("2026-02") });
  try {
    const a = await s.addSession("2026-02-07"); await s.mark(a, "trial_paid");
    const b = await s.addSession("2026-02-14"); await s.mark(b, "trial_free");
    await s.completeMonth("2026-02");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-02",
      now: s.now,
    });
    const inv = await getInvoice(s.db, s.parentId, "2026-02");
    assertEquals(inv!.gross, 25); // only the paid trial
  } finally {
    await s.teardown();
  }
});

Deno.test("no double-billing: second run skips the existing invoice", async () => {
  const s = await newScenario({ billing: monthEnded("2026-03") });
  try {
    const a = await s.addSession("2026-03-07"); await s.mark(a, "present");
    await s.completeMonth("2026-03");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-03", now: s.now });
    const res2 = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-03", now: s.now });
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

Deno.test("edge 11.1: last-day-of-month lesson is billed in that month; next-month lesson is excluded (leap Feb)", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2028-02") });
  try {
    // Leap-year last day (exercises core.ts lastDay = new Date(y, m, 0)),
    // plus a lesson on the 1st of the NEXT month that must NOT be swept in.
    const last = await s.addSession("2028-02-29"); await s.mark(last, "present");
    const next = await s.addSession("2028-03-01"); await s.mark(next, "present");
    await s.completeMonth("2028-02");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2028-02",
      now: s.now,
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

// ── Billing follows attendance, not current enrolment ──────────────────────

Deno.test("a child unenrolled mid-month is still billed for lessons they attended", async () => {
  // The trap behind the new "remove from class" action. Billing used to build
  // its student list from ACTIVE enrolments, so closing an enrolment silently
  // dropped that child's already-attended lessons from the invoice — one tap
  // would have cost a month's revenue for them. Who must be MARKED still comes
  // from enrolments; who gets BILLED now comes from the attendance rows.
  const s = await newScenario({ price: 30, billing: monthEnded("2027-10") });
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
      now: s.now,
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
