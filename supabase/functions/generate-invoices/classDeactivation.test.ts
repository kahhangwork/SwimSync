// ============================================================
// `classes.is_active` means SCHEDULING, not billing (Wave 1 item #6).
//
// Two halves that pull in opposite directions, which is the whole reason this
// file exists rather than a couple of cases bolted onto core.test.ts:
//
//   * The TALLY widened. A class retired at month end still bills the lessons
//     it actually taught — that is BACKLOG #6's complaint, and it was a silent
//     underbill sitting exactly where someone is tidying up.
//   * The COMPLETENESS GATE did not. `core.ts`'s class scan feeds both, so
//     widening it naively means an inactive class with a live enrolment and no
//     recorded sessions expects a lesson on every weekly date, finds nobody
//     marked, and blocks the month — with no override (§8a) and no screen able
//     to clear it, because the coach class list, the coach Schedule tab and the
//     admin Classes page all filter `is_active`. RISK 1 in WAVE_1_PLAN.md, the
//     wave's rank-1 risk.
//
// PROVEN RED (§7.25), both directions, 2026-08-09:
//   * "no sessions" below fails with `incomplete_attendance` against a naive
//     deletion of `.eq("is_active", true)` with no deactivated_at clamp — the
//     exact shape the plan told us not to ship.
//   * "unmarked BEFORE deactivation" fails against a clamp that exempts an
//     inactive class from the gate wholesale instead of clamping it by date.
//     Without that second case the first one is satisfiable by simply never
//     checking an inactive class, which is the permanent underbill.
// ============================================================

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateInvoices } from "./core.ts";
import {
  getInvoice,
  monthEnded,
  newScenario,
  type Scenario,
} from "./test-helpers.ts";

/** Retire a class the way deactivate_class() does — both columns together.
 *  Writing `is_active` alone is the PRE-RPC shape and means something
 *  different to the engine (see "legacy" below); no test may conflate them. */
async function retire(s: Scenario, on: string, classId?: string) {
  const { error } = await s.db
    .from("classes")
    .update({ is_active: false, deactivated_at: `${on}T12:00:00+08:00` })
    .eq("id", classId ?? s.classId);
  if (error) throw new Error(error.message);
}

// ── The discriminating case RISK 1 names ────────────────────────────────────
// Inactive class, one ACTIVE enrolment, and nothing recorded in the month.
// Before the fix this class was skipped outright; a naive widening makes it
// block forever. Neither is right — it must simply have no bearing on the
// month, which is what it had before anyone touched it.
Deno.test("inactive class with a live enrolment and NO sessions does not block the month", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-06") });
  try {
    // Retired before the billing month opened: it ran no lessons in June and
    // is expected to owe none. The enrolment is deliberately left OPEN — that
    // is the state that generates the unclearable expectation.
    await retire(s, "2029-05-20");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2029-06",
      now: s.now,
    });

    assertEquals(
      res.status === "incomplete_attendance",
      false,
      "a retired class with nothing recorded must not block the month — there is no screen that could ever clear it",
    );
    assertEquals(res.classes_still_incomplete ?? 0, 0, "and nothing is incomplete");
  } finally {
    await s.teardown();
  }
});

// ── BACKLOG #6 itself: the lessons it DID teach still bill ─────────────────
Deno.test("a class retired at month end still bills the lessons it taught", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-06") });
  try {
    const sess = await s.addSession("2029-06-02");
    await s.mark(sess, "present");
    await s.completeMonth("2029-06");

    // Tidying up after the last lesson — the exact moment the old scan lost
    // the money.
    await retire(s, "2029-06-30");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2029-06",
      now: s.now,
    });

    assertEquals(res.sealed, true, "the month still seals");
    const inv = await getInvoice(s.db, s.parentId, "2029-06");
    assertEquals(inv!.gross, 40, "the taught lesson bills — this is the underbill BACKLOG #6 filed");
  } finally {
    await s.teardown();
  }
});

// ── The clamp is a DATE, not an exemption ──────────────────────────────────
// The mirror of the first test, and the one that stops it being satisfied by
// "never check an inactive class". A lesson that ran BEFORE the class was
// retired is still owed a mark, and must still block. Skipping it would seal
// the month over an unbillable lesson — permanent, since an invoice can never
// be added to afterwards (§11.6).
Deno.test("a lesson unmarked BEFORE deactivation still blocks the month", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-06") });
  try {
    // 2029-06-02 and 06-09 are Saturdays, the scenario's class day. Mark only
    // the first, then retire the class after BOTH were due.
    const sess = await s.addSession("2029-06-02");
    await s.mark(sess, "present");
    await retire(s, "2029-06-20");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2029-06",
      now: s.now,
    });

    assertEquals(
      res.status,
      "incomplete_attendance",
      "lessons due before the class was retired are still owed marks",
    );
    assertEquals(res.sealed, false, "and the month must not seal over them");
  } finally {
    await s.teardown();
  }
});

// ── ...and expects nothing AFTER it ────────────────────────────────────────
// NO completeMonth() HERE, AND THAT IS THE TEST. completeMonth() marks every
// still-due lesson `cancelled_rain`, which satisfies the gate on its own — with
// it, this case passes against a completely unclamped engine and asserts
// nothing (§7.54, and the vacuity trap the plan flagged on makeups.test.ts).
// The 16th, 23rd and 30th are left genuinely untouched, so the clamp is the
// only reason the month can seal.
Deno.test("a lesson date after deactivation is not expected", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-06") });
  try {
    // Everything up to the 9th taught and marked; retired on the 12th. The
    // 16th, 23rd and 30th are Saturdays that never happened.
    for (const d of ["2029-06-02", "2029-06-09"]) {
      const sess = await s.addSession(d);
      await s.mark(sess, "present");
    }
    await retire(s, "2029-06-12");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2029-06",
      now: s.now,
    });

    assertEquals(res.sealed, true, "the weeks it was not running are not gaps");
    const inv = await getInvoice(s.db, s.parentId, "2029-06");
    assertEquals(inv!.gross, 80, "two taught lessons, and only two");
  } finally {
    await s.teardown();
  }
});

// ── The legacy row can no longer be CREATED, and that is the assertion ─────
// This test used to construct `is_active = false` with no `deactivated_at` —
// a class made inactive before deactivate_class() existed — and assert the
// engine's conservative branch for it: expects nothing, still bills what it
// recorded.
//
// Since 20260810000100 that shape is refused by
// `classes_inactive_requires_deactivated_at`, so the old test asserted engine
// behaviour for a state the database will not hold. Rewritten rather than
// deleted, because the constraint is now load-bearing for the ENGINE and
// deserves an assertion from the engine's own side:
//
// `lastScheduledDate` is null exactly when `is_active = false AND
// deactivated_at IS NULL`, and null means "expect nothing". That is correct for
// a DERIVED weekday date and would be a silent underbill if it ever reached a
// booking — which is precisely why `bookingsByDate` is never clamped (core.ts).
// The constraint is what makes that prohibition structural instead of a comment
// someone has to remember, so if it is ever dropped, THIS is what goes red.
//
// ⚠ The null branch in core.ts's `lastScheduledDate` is deliberately KEPT even
// though this constraint makes it unreachable. Removing it would leave
// `new Date(String(null))` → Invalid Date on any future row that slips through,
// which fails silently. Unreachable defence with a loud alternative is worth
// its two lines; §7.110 removed an unreachable arm whose failure mode was a
// loud throw, and that asymmetry is the whole reason.
Deno.test("the legacy inactive-with-no-date shape cannot be created at all", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-06") });
  try {
    const sess = await s.addSession("2029-06-02");
    await s.mark(sess, "present");

    // service_role does NOT bypass a CHECK constraint — it bypasses RLS. This
    // is the same write the old version of this test performed silently.
    const { error } = await s.db
      .from("classes")
      .update({ is_active: false })
      .eq("id", s.classId);

    assertEquals(
      error?.code,
      "23514",
      "retiring a class without recording WHEN must be refused by the database, not merely avoided by the UI",
    );

    // The write was REFUSED, not silently partially applied — so the class is
    // still running and the engine still treats it as such. Asserted because
    // the old version of this test performed the same update and never checked
    // its error: it would have gone on believing the class was retired.
    const { data: after } = await s.db
      .from("classes")
      .select("is_active, deactivated_at")
      .eq("id", s.classId)
      .single();
    assertEquals(after!.is_active, true, "the class is untouched");
    assertEquals(after!.deactivated_at, null, "and no date was written either");
  } finally {
    await s.teardown();
  }
});
