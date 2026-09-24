// The generation run log (docs/plans/BILLING_MONTHS_PLAN.md §5).
//
// What these pin, in order of what would hurt most:
//   ⚠ RISK 1 — the row is actually WRITTEN. recordRuns is best-effort and never
//     throws, so a missing service_role grant would pass every test that only
//     checks the billing result. The integration tests read the row back.
//   ⚠ RISK 3 — refusals to attempt write NOTHING (cron would flood the log).
//   Best-effort — a failed write never throws and never touches billing.
//   ⚠ RISK 5 — a scenario's runs go with its tenant (FK cascade), so the second
//     test.sh pass is not running on leaked rows (§7.15).
//
// Pure tests first (no database), then integration against the local stack.

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateInvoices, type GenerateResult } from "./core.ts";
import {
  ERROR_MAX_CHARS,
  NON_ATTEMPT_STATUSES,
  recordRuns,
  toErrorRows,
  toRunRows,
} from "./runLog.ts";
import { getInvoice, monthEnded, newScenario, svc } from "./test-helpers.ts";

const T = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";

// ── Pure ──────────────────────────────────────────────────────────────────────

Deno.test("RISK 3: every non-attempt status writes ZERO rows", () => {
  const statuses = [
    "before_run_day",
    "auto_disabled",
    "tenant_suspended",
    "month_not_ended",
    "already_complete",
    "tenant_unreadable",
  ];
  // The exported set is the single source — if it shrinks, this names it.
  assertEquals([...NON_ATTEMPT_STATUSES].sort(), [...statuses].sort());
  for (const status of statuses) {
    const rows = toRunRows({ tenant_id: T, billing_month: "2026-08", status }, {});
    assertEquals(rows.length, 0, `${status} must not be logged`);
  }
});

Deno.test("a blocked run is ONE row carrying its blocking lessons", () => {
  const blocking = [{
    tenant_id: T, class_id: "c", class_title: "Sat 9am",
    session_date: "2026-08-02", unmarked_student_count: 2,
  }];
  const rows = toRunRows(
    { tenant_id: T, billing_month: "2026-08", status: "incomplete_attendance",
      mode: "manual", sealed: false, invoices_created: 0, blocking },
    { requested_by: ADMIN, mode: "manual" },
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "incomplete_attendance");
  assertEquals(rows[0].blocking, blocking);
  assertEquals(rows[0].ran_by, ADMIN);
  assertEquals(rows[0].sealed, false);
});

Deno.test("an unclaimed-open run keeps the child's name; a sealed run is sealed", () => {
  const unclaimed = [{
    student_id: "s", student_name: "Walk In", lessons: 1,
    earliest_session_date: "2026-08-02", latest_session_date: "2026-08-02",
  }];
  const [open] = toRunRows({
    tenant_id: T, billing_month: "2026-08", sealed: false, invoices_created: 9,
    status: "open — 1 billable lesson(s) have no parent account to bill",
    unclaimed_billable: 1, unclaimed_students: unclaimed,
  }, {});
  assertEquals(open.unclaimed_students, unclaimed);
  assertEquals(open.unclaimed_billable, 1);
  assertEquals(open.invoices_created, 9);
  assertEquals(open.ran_by, null, "no requested_by = the cron");

  const [sealed] = toRunRows({
    tenant_id: T, billing_month: "2026-07", status: "complete — billing month sealed",
    sealed: true, invoices_created: 12,
  }, {});
  assertEquals(sealed.sealed, true);
  assertEquals(sealed.unclaimed_students, null, "an empty list is stored as NULL");
});

Deno.test("a cron run logs each tenant's ATTEMPT and skips the rest", () => {
  const result: GenerateResult = {
    billing_month: "2026-08", status: "processed 3 tenant(s)",
    per_tenant: [
      { tenant_id: T, billing_month: "2026-08", status: "nothing_to_bill" },
      { tenant_id: T2, billing_month: "2026-08", status: "before_run_day" },
      { billing_month: "2026-08", status: "earlier_month_unbilled" }, // no tenant: skipped
    ],
  };
  const rows = toRunRows(result, { mode: "auto" });
  assertEquals(rows.map((r) => r.tenant_id), [T]);
  assertEquals(rows[0].mode, "auto");
});

Deno.test("earlier_month_unbilled records WHICH month blocks it", () => {
  const [r] = toRunRows({
    tenant_id: T, billing_month: "2026-08", status: "earlier_month_unbilled",
    earlier_unbilled_month: "2026-07",
  }, {});
  assertEquals(r.earlier_unbilled_month, "2026-07");
});

Deno.test("a malformed requested_by is dropped, not allowed to fail the insert", () => {
  const [r] = toRunRows({ tenant_id: T, billing_month: "2026-08", status: "nothing_to_bill" },
    { requested_by: "not-a-uuid" });
  assertEquals(r.ran_by, null);
});

Deno.test("RISK 11: an error row is the message only, truncated", () => {
  const e = new Error("x".repeat(2000));
  const [r] = toErrorRows({ tenant_id: T, billing_month: "2026-08", mode: "manual" }, e);
  assertEquals(r.status, "error");
  assertEquals(r.error!.length, ERROR_MAX_CHARS);
  assert(!r.error!.includes("at "), "no stack frames");
});

Deno.test("an unattributable crash (cron-wide, no tenant) writes nothing", () => {
  assertEquals(toErrorRows({ mode: "auto" }, new Error("boom")).length, 0);
  assertEquals(toErrorRows({ tenant_id: T }, new Error("boom")).length, 0, "no month either");
});

// ── Integration ───────────────────────────────────────────────────────────────

Deno.test("RISK 1: an unclaimed-open run is WRITTEN and names the child", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-06") });
  try {
    const d = "2027-06-05";
    const sess = await s.addSession(d);
    await s.mark(sess, "present");
    const walkIn = await s.addUnclaimedStudent({ name: "Walk In", enrolment: "trial", on: d });
    await s.mark(sess, "trial_paid", walkIn);
    await s.completeMonth("2027-06");

    const opts = { tenant_id: s.tenantId, mode: "manual", billing_month: "2027-06", now: s.now };
    const res = await generateInvoices(s.db, opts);
    const { recorded } = await recordRuns(s.db, toRunRows(res, opts));
    assertEquals(recorded, 1, "the write must SUCCEED — a 0 here is RISK 1");

    const { data: rows, error } = await s.db
      .from("billing_runs")
      .select("status, sealed, invoices_created, unclaimed_billable, unclaimed_students")
      .eq("tenant_id", s.tenantId);
    assertEquals(error, null);
    assertEquals(rows!.length, 1, "the row is really in the table");
    assertEquals(rows![0].sealed, false);
    assertEquals(rows![0].invoices_created, 1);
    assertEquals(rows![0].unclaimed_billable, 1);
    const names = (rows![0].unclaimed_students as { student_name: string }[])
      .map((u) => u.student_name);
    assertEquals(names, ["Walk In"]);
  } finally {
    await s.teardown();
  }
});

Deno.test("a failed log write never throws and leaves billing intact", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-07") });
  try {
    const sess = await s.addSession("2027-07-03");
    await s.mark(sess, "present");
    await s.completeMonth("2027-07");

    const opts = { tenant_id: s.tenantId, mode: "manual", billing_month: "2027-07", now: s.now };
    const res = await generateInvoices(s.db, opts);
    // Force the insert to fail: a month the table's CHECK rejects.
    const bad = toRunRows(res, opts).map((r) => ({ ...r, billing_month: "bad" }));
    const { recorded } = await recordRuns(s.db, bad); // must not throw
    assertEquals(recorded, 0);

    assertEquals(res.sealed, true);
    const inv = await getInvoice(s.db, s.parentId, "2027-07");
    assertEquals(inv!.gross, 30, "the invoice stands");
  } finally {
    await s.teardown();
  }
});

Deno.test("RISK 5: a scenario's runs are gone with its tenant", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-08") });
  const tenantId = s.tenantId;
  try {
    const opts = { tenant_id: tenantId, mode: "manual", billing_month: "2027-08", now: s.now };
    const res = await generateInvoices(s.db, opts);
    assertEquals((await recordRuns(s.db, toRunRows(res, opts))).recorded, 1);
  } finally {
    await s.teardown();
  }
  const { data } = await svc().from("billing_runs").select("id").eq("tenant_id", tenantId);
  assertEquals(data!.length, 0, "teardown's tenant delete must cascade the log");
});
