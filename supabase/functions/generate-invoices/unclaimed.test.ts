// Unclaimed students and the month seal (TRIAL_ONBOARDING_PLAN.md phase 2).
//
// A student with no parent_students row cannot be invoiced — there is nobody to
// bill. The engine has ALWAYS silently dropped their billable attendance
// (core.ts resolves attendance→parent with a plain .in() lookup, and no rows
// come back). What it must NOT do is then SEAL the month: a sealed month is
// never reprocessed, so those lessons become permanently unbillable the moment
// the parent finally registers. Same permanent-underbill shape as §7.8, §7.13
// and §7.32, through a fourth door.
//
// So: unclaimed BILLABLE attendance holds the month open until it is either
// claimed (the parent registers) or SETTLED (the admin records money taken
// outside SwimSync, or writes it off).
//
// THESE TESTS WERE WRITTEN AND PROVEN RED BEFORE core.ts CHANGED (RISK 2 in the
// plan). A test that was never red proves nothing.
//
// Class weekday defaults to SATURDAY, so every date below is a Saturday of its
// month. Each test uses its own month purely for readability — newScenario()
// already gives each its own tenant.

import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateInvoices } from "./core.ts";
import { newScenario, monthEnded, getInvoice } from "./test-helpers.ts";

// ── TRIPWIRE ──────────────────────────────────────────────────────────────────
// The most important test here. RISK 1: the new unclaimed logic is a REPORT and
// must not touch the billing path. A tenant with no unclaimed students must
// bill EXACTLY as before — same gross, same net, same item count — and still
// seal. If this fails, the feature changed billing for every existing customer.
Deno.test("TRIPWIRE: no unclaimed students → billing and sealing unchanged", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-10") });
  try {
    for (const d of ["2026-10-03", "2026-10-10"]) {
      const sess = await s.addSession(d);
      await s.mark(sess, "present");
    }
    await s.completeMonth("2026-10");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2026-10",
      now: s.now,
    });

    assertEquals(res.invoices_created, 1, "one invoice for the one parent");
    assertEquals(res.sealed, true, "a clean month still seals");
    assertEquals(res.unclaimed_billable, 0);

    const inv = await getInvoice(s.db, s.parentId, "2026-10");
    assertEquals(inv!.gross, 60, "2 lessons x $30");
    assertEquals(inv!.net, 60);

    const { data: items } = await s.db
      .from("invoice_items").select("id").eq("invoice_id", inv!.id);
    assertEquals(items!.length, 2, "one item per billable lesson");
  } finally {
    await s.teardown();
  }
});

// ── THE BLOCK ─────────────────────────────────────────────────────────────────

Deno.test("unclaimed billable attendance holds the month OPEN", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-11") });
  try {
    const d = "2026-11-07";
    const sess = await s.addSession(d);
    await s.mark(sess, "present");

    // A walk-in the coach added at the poolside: no parent account.
    const walkIn = await s.addUnclaimedStudent({
      name: "Walk In", enrolment: "trial", on: d,
    });
    await s.mark(sess, "trial_paid", walkIn);
    await s.completeMonth("2026-11");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2026-11", now: s.now,
    });

    assertEquals(res.sealed, false,
      "the month must NOT seal while a billable lesson has no parent to bill");
    assertEquals(res.unclaimed_billable, 1,
      "the run must REPORT the unclaimed lesson, not swallow it");

    // The claimed parent is still billed — the block holds the month open, it
    // does not hold everyone else's invoice hostage.
    assertEquals(res.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, "2026-11");
    assertEquals(inv!.gross, 30, "the walk-in is on nobody's invoice");
  } finally {
    await s.teardown();
  }
});

Deno.test("a FREE trial by an unclaimed student does not block — nothing is billable", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-12") });
  try {
    const d = "2026-12-05";
    const sess = await s.addSession(d);
    await s.mark(sess, "present");

    const walkIn = await s.addUnclaimedStudent({
      name: "Free Trial", enrolment: "trial", on: d,
    });
    await s.mark(sess, "trial_free", walkIn);
    await s.completeMonth("2026-12");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2026-12", now: s.now,
    });

    assertEquals(res.unclaimed_billable, 0, "trial_free is not billable");
    assertEquals(res.sealed, true, "so the month is genuinely finished");
  } finally {
    await s.teardown();
  }
});

// ── THE ESCAPE HATCH ──────────────────────────────────────────────────────────

Deno.test("a settlement covering the lesson date unblocks the month", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-01") });
  try {
    const d = "2027-01-02";
    const sess = await s.addSession(d);
    await s.mark(sess, "present");

    const walkIn = await s.addUnclaimedStudent({ enrolment: "trial", on: d });
    await s.mark(sess, "trial_paid", walkIn);
    // The admin records the PayNow that arrived outside SwimSync.
    await s.settle(walkIn, { through: d, kind: "paid_outside", amount: 30 });
    await s.completeMonth("2027-01");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-01", now: s.now,
    });

    assertEquals(res.unclaimed_billable, 0, "settled attendance no longer counts");
    assertEquals(res.sealed, true);
  } finally {
    await s.teardown();
  }
});

Deno.test("a write-off unblocks the month too — it just claims no money", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-02") });
  try {
    const d = "2027-02-06";
    const sess = await s.addSession(d);
    await s.mark(sess, "present");

    const walkIn = await s.addUnclaimedStudent({ enrolment: "trial", on: d });
    await s.mark(sess, "trial_paid", walkIn);
    await s.settle(walkIn, { through: d, kind: "written_off" });
    await s.completeMonth("2027-02");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-02", now: s.now,
    });

    assertEquals(res.unclaimed_billable, 0);
    assertEquals(res.sealed, true);
  } finally {
    await s.teardown();
  }
});

// The effective-dating is the whole reason settled_through is a DATE and not a
// boolean. A settlement for an earlier period must not silently cover a lesson
// taught afterwards — otherwise settling once blanket-authorises every future
// lesson that student ever attends unclaimed.
Deno.test("a settlement dated BEFORE the lesson does not cover it", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-03") });
  try {
    const early = "2027-03-06";
    const later = "2027-03-13";

    const sessEarly = await s.addSession(early);
    await s.mark(sessEarly, "present");
    const sessLater = await s.addSession(later);
    await s.mark(sessLater, "present");

    const walkIn = await s.addUnclaimedStudent({ enrolment: "trial", on: later });
    await s.mark(sessLater, "trial_paid", walkIn);
    // Settled only through the EARLIER date.
    await s.settle(walkIn, { through: early, kind: "paid_outside", amount: 30 });
    await s.completeMonth("2027-03");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-03", now: s.now,
    });

    assertEquals(res.unclaimed_billable, 1,
      "a lesson AFTER settled_through is still unsettled");
    assertEquals(res.sealed, false);
  } finally {
    await s.teardown();
  }
});

Deno.test("a REVERSED settlement stops covering — the block returns", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-04") });
  try {
    const d = "2027-04-03";
    const sess = await s.addSession(d);
    await s.mark(sess, "present");

    const walkIn = await s.addUnclaimedStudent({ enrolment: "trial", on: d });
    await s.mark(sess, "trial_paid", walkIn);
    await s.settle(walkIn, { through: d, kind: "written_off", reversed: true });
    await s.completeMonth("2027-04");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-04", now: s.now,
    });

    assertEquals(res.unclaimed_billable, 1, "a reversed settlement covers nothing");
    assertEquals(res.sealed, false);
  } finally {
    await s.teardown();
  }
});

// The existing-student-whose-parent-is-slow case. Their enrolment is OPEN, so
// they also participate in the completeness gate normally — and every lesson
// they attended is unbillable, not just one.
Deno.test("an ongoing unclaimed student blocks for every lesson attended", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-05") });
  try {
    const slow = await s.addUnclaimedStudent({
      name: "Slow Parent Kid", enrolment: "ongoing",
    });

    for (const d of ["2027-05-01", "2027-05-08"]) {
      const sess = await s.addSession(d);
      await s.mark(sess, "present");
      await s.mark(sess, "present", slow);
    }
    await s.completeMonth("2027-05");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-05", now: s.now,
    });

    assertEquals(res.unclaimed_billable, 2, "both lessons are unbillable");
    assertEquals(res.sealed, false);
    assert(
      (res.unclaimed_students ?? []).some((u) => u.student_id === slow),
      "the run must name the student so the admin can act on it"
    );
  } finally {
    await s.teardown();
  }
});
