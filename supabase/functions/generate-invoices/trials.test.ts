// Trials as bookings, and what a paid trial costs
// (TRIAL_BOOKINGS_PLAN.md phase 4).
//
// Two things are under test and they fail in opposite directions:
//
//   BLOCKING — a booked child is expected at exactly ONE lesson. Expect them at
//   every lesson and the month never closes; expect them at none and a paid
//   trial is silently never billed, which is the failure this whole feature
//   exists to prevent.
//
//   PRICING — a paid trial is priced by the category the trial was SOLD under,
//   on the lesson's own date. Get the fallback wrong in one direction and an
//   unpriced business cannot bill at all; in the other, a trial silently bills
//   $0 on a document that freezes when created (§11.6).
//
// The class weekday defaults to SATURDAY, so every date below is a Saturday.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateInvoices } from "./core.ts";
import { newScenario, monthEnded, getInvoice } from "./test-helpers.ts";

// ── BLOCKING ────────────────────────────────────────────────────────────────

Deno.test("a booked trial is expected on ITS date, and blocks while unmarked", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-06") });
  try {
    const sess = await s.addSession("2027-06-05");
    await s.mark(sess, "present");

    const kid = await s.addUnclaimedStudent({ name: "Trial Kid", enrolment: "none" });
    await s.bookTrial(kid, "2027-06-05");
    await s.completeMonth("2027-06");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-06", now: s.now,
    });

    assertEquals(res.sealed, false, "an unmarked booking holds the month open");
    assertEquals(
      res.status,
      "incomplete_attendance",
      "and it reports as unmarked attendance — because that is what it is"
    );
  } finally {
    await s.teardown();
  }
});

// The other direction, and the reason the expected set became per-date: a
// booking must NOT make the child expected at every other lesson of the month.
Deno.test("a booked trial is NOT expected at the class's other lessons", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-07") });
  try {
    const sessions: Record<string, string> = {};
    for (const d of ["2027-07-03", "2027-07-10"]) {
      sessions[d] = await s.addSession(d);
      await s.mark(sessions[d], "present");
    }

    const kid = await s.addUnclaimedStudent({ name: "One Lesson Kid", enrolment: "none" });
    await s.bookTrial(kid, "2027-07-03");
    // Marked on their own date only. Reuses the session created above —
    // lesson_sessions is UNIQUE (class_id, session_date), which is exactly the
    // constraint that stops a second one double-billing a class (§7.7).
    await s.mark(sessions["2027-07-03"], "trial_free", kid);
    await s.completeMonth("2027-07");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-07", now: s.now,
    });

    assertEquals(
      res.sealed,
      true,
      "the 10th does not expect them — a trial is one lesson, not a standing arrangement"
    );
  } finally {
    await s.teardown();
  }
});

Deno.test("a CANCELLED booking expects nobody", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-08") });
  try {
    const sess = await s.addSession("2027-08-07");
    await s.mark(sess, "present");

    const kid = await s.addUnclaimedStudent({ name: "Cancelled Kid", enrolment: "none" });
    const booking = await s.bookTrial(kid, "2027-08-07");
    await s.db
      .from("trial_bookings")
      .update({ cancelled_at: new Date(0).toISOString(), cancelled_by: s.coachProfileId })
      .eq("id", booking);
    await s.completeMonth("2027-08");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-08", now: s.now,
    });

    assertEquals(res.sealed, true, "a cancelled booking does not hold the month open");
  } finally {
    await s.teardown();
  }
});

// ── PRICING ─────────────────────────────────────────────────────────────────
// The trial child is CLAIMED here (the scenario's own parent) so the amount
// lands on an invoice we can read. Unclaimed trials are covered by
// unclaimed.test.ts.

/** Attach the scenario's parent to a student, so their lessons are invoiceable. */
async function claim(s: Awaited<ReturnType<typeof newScenario>>, studentId: string) {
  await s.db.from("parent_students").insert({
    parent_id: s.parentId,
    student_id: studentId,
  });
}

Deno.test("with NO trial rate set, a paid trial bills at the CLASS rate", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-09") });
  try {
    const kid = await s.addUnclaimedStudent({ name: "Unpriced Trial", enrolment: "none" });
    await claim(s, kid);
    await s.bookTrial(kid, "2027-09-04");

    const sess = await s.addSession("2027-09-04");
    await s.mark(sess, "present");
    await s.mark(sess, "trial_paid", kid);
    await s.completeMonth("2027-09");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-09", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-09");
    // 30 (the enrolled child, present) + 30 (the trial, at the class rate).
    assertEquals(inv!.gross, 60, "an unpriced category falls back to the class rate — never 0");
  } finally {
    await s.teardown();
  }
});

Deno.test("with a trial rate set, a paid trial bills at THAT rate", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-10") });
  try {
    await s.setTrialRate(s.categoryId, 12, "2027-01-01");

    const kid = await s.addUnclaimedStudent({ name: "Priced Trial", enrolment: "none" });
    await claim(s, kid);
    await s.bookTrial(kid, "2027-10-02");

    const sess = await s.addSession("2027-10-02");
    await s.mark(sess, "present");
    await s.mark(sess, "trial_paid", kid);
    await s.completeMonth("2027-10");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-10", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-10");
    assertEquals(inv!.gross, 42, "30 for the enrolled lesson + 12 for the trial");
  } finally {
    await s.teardown();
  }
});

// The whole reason trial_rates is effective-dated: raising the price must not
// re-value a trial already taught.
Deno.test("a rate effective AFTER the lesson does not apply to it", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-11") });
  try {
    await s.setTrialRate(s.categoryId, 12, "2027-01-01");
    await s.setTrialRate(s.categoryId, 99, "2027-12-01"); // after the lesson

    const kid = await s.addUnclaimedStudent({ name: "Dated Trial", enrolment: "none" });
    await claim(s, kid);
    await s.bookTrial(kid, "2027-11-06");

    const sess = await s.addSession("2027-11-06");
    await s.mark(sess, "present");
    await s.mark(sess, "trial_paid", kid);
    await s.completeMonth("2027-11");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-11", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-11");
    assertEquals(inv!.gross, 42, "the rate in force ON THE LESSON'S DATE — 12, not 99");
  } finally {
    await s.teardown();
  }
});

// ⚠ THE SNAPSHOT TEST. classes.category_id is mutable and money depends on it.
// Without trial_bookings.category_id, re-tagging a class would silently reprice
// every unbilled trial in it — §7.7 through a new door.
Deno.test("re-tagging the CLASS does not reprice a trial already booked", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-12") });
  try {
    await s.setTrialRate(s.categoryId, 12, "2027-01-01");   // the sold category
    await s.setTrialRate(s.categoryId2, 88, "2027-01-01");  // the one we move to

    const kid = await s.addUnclaimedStudent({ name: "Snapshot Trial", enrolment: "none" });
    await claim(s, kid);
    await s.bookTrial(kid, "2027-12-04"); // snapshots categoryId

    // The admin re-tags the class afterwards.
    await s.db
      .from("classes")
      .update({ category_id: s.categoryId2 })
      .eq("id", s.classId);

    const sess = await s.addSession("2027-12-04");
    await s.mark(sess, "present");
    await s.mark(sess, "trial_paid", kid);
    await s.completeMonth("2027-12");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-12", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-12");
    assertEquals(
      inv!.gross,
      42,
      "priced from the BOOKING's category (12), not the class's current one (88)"
    );
  } finally {
    await s.teardown();
  }
});

// One keystroke from being swept into the pricing branch.
Deno.test("trial_free stays free even with a trial rate configured", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2028-01") });
  try {
    await s.setTrialRate(s.categoryId, 12, "2027-01-01");

    const kid = await s.addUnclaimedStudent({ name: "Free Trial", enrolment: "none" });
    await claim(s, kid);
    await s.bookTrial(kid, "2028-01-01");

    const sess = await s.addSession("2028-01-01");
    await s.mark(sess, "present");
    await s.mark(sess, "trial_free", kid);
    await s.completeMonth("2028-01");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2028-01", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2028-01");
    assertEquals(inv!.gross, 30, "only the enrolled lesson — a free trial contributes 0");
  } finally {
    await s.teardown();
  }
});

// The status chooses the price, and the coach chooses the status.
Deno.test("a booked child marked PRESENT bills the class rate, not the trial rate", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2028-02") });
  try {
    await s.setTrialRate(s.categoryId, 12, "2027-01-01");

    const kid = await s.addUnclaimedStudent({ name: "Present Trial", enrolment: "none" });
    await claim(s, kid);
    await s.bookTrial(kid, "2028-02-05");

    const sess = await s.addSession("2028-02-05");
    await s.mark(sess, "present");
    await s.mark(sess, "present", kid);
    await s.completeMonth("2028-02");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2028-02", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2028-02");
    assertEquals(inv!.gross, 60, "present is a normal lesson at the class rate");
  } finally {
    await s.teardown();
  }
});
