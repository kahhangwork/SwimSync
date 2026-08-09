// ============================================================
// A CLASS WHOSE ONLY ATTENDEE IS A GUEST — the unmarked-booking underbill.
//
// `core.ts` bails out of its per-class loop at two early guards, and until
// 20260810 NEITHER consulted `bookingsByDate`:
//
//   core.ts  "nothing recorded and nothing due"   (sessions + expectedDates)
//   core.ts  "nobody enrolled and nobody marked"  (billableStudentIds)
//
// The completeness gate twelve lines below them DOES union booking dates in, so
// the gate was correct and unreachable. A class with no ACTIVE enrolments but
// holding an unmarked trial or make-up booking was skipped whole: the guest was
// neither billed nor blocking. Alone that only left the month open; alongside a
// second class that billed, the month SEALED over the guest and that lesson
// could never be invoiced afterwards (§11.6). A silent permanent underbill —
// the failure shape this project treats as its worst.
//
// ⚠ THIS IS WIDER THAN RETIRED CLASSES. Every case below uses an ACTIVE class
// whose students have simply all left. That is the reachable, common shape —
// and the local seed's default one (§7.100). Retiring a class made the state
// reachable by construction; it was never confined to it.
//
// PROVEN RED (§7.25), 2026-08-10, by reverting both guards to their pre-fix
// form and re-running this file. MEASURED signature:
//
//   1 unmarked guest BLOCKS       FAILS — `sealed` is true. The bug itself.
//   2 guest-only class alone      FAILS — same cause, without a second class.
//   3 empty class does not block  passes — the counterweight; see below.
//   4 MARKED guest is billed      passes — and that is CORRECT, see below.
//
// ⚠ CASE 4 PASSES WITHOUT THE FIX, AND SAYING SO IS THE POINT. A marked guest
// has a `lesson_sessions` row and an `attendance` row, so `sessionIds` and
// `attendedStudentIds` are both non-empty and NEITHER guard ever fired for it.
// The bug was only ever about UNMARKED bookings. Case 4 is therefore a
// REGRESSION guard, not a red-proof one: it pins that widening the guards did
// not disturb the already-working marked path — which is exactly what a naive
// "just add the booked ids to billableStudentIds" fix would have risked.
// Case 3 is the same kind of guard pointing the other way. Only 1 and 2 are
// evidence the bug existed; do not "strengthen" 3 or 4 into failing cases.
//
// ⚠ NO `completeMonth()` ON THE CLASS UNDER TEST (§7.111). It marks every
// still-due lesson `cancelled_rain`, which satisfies the very gate these cases
// assert on; two classDeactivation.test.ts cases were vacuous for exactly that
// reason. It IS used on the *other* class in case 1, and that is mandatory
// rather than sloppy — see the note there.
// ============================================================

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateInvoices } from "./core.ts";
import { getInvoice, monthEnded, newScenario, type Scenario } from "./test-helpers.ts";

/** Close the primary child's enrolment before the billing month opens, leaving
 *  the class with NO active enrolments. Deliberately a SPAN that ends before
 *  June rather than a delete: the class keeps its history, which is what makes
 *  `earliestEnrolment` non-null and the window start at the month boundary. */
async function emptyTheClass(s: Scenario, on: string, classId?: string) {
  const { error } = await s.db
    .from("student_class_enrolments")
    .update({ is_active: false, unenrolled_at: `${on}T12:00:00+08:00` })
    .eq("class_id", classId ?? s.classId);
  if (error) throw new Error(error.message);
}

// ── 1. THE BUG ITSELF ───────────────────────────────────────────────────────
// Guest-only class beside a class that bills cleanly. Before the fix the month
// SEALED and the guest's lesson became permanently unbillable.
Deno.test("an unmarked guest in a class with no active enrolments BLOCKS the month", async () => {
  const s = await newScenario({
    price: 40,
    secondClass: { price: 50 },
    billing: monthEnded("2029-06"),
  });
  try {
    // Class 1 empties out in May: no active enrolments in June, no sessions.
    await emptyTheClass(s, "2029-05-20");

    // Class 2 bills normally and is COMPLETE.
    //
    // ⚠ completeMonth() ON CLASS 2 IS LOAD-BEARING, NOT PADDING. If class 2
    // also blocked, `sealed === false` would be true no matter what the guest
    // class did, and this test would pass against the unfixed engine. The
    // assertion that discriminates is therefore not `sealed` alone but WHICH
    // class appears in `blocking` — see below.
    const sess2 = await s.addSession("2029-06-02", s.classId2!);
    await s.mark(sess2, "present", s.studentId2!);
    await s.completeMonth("2029-06", s.classId2!, s.now);

    // The guest: an enrolled child of class 2, hosted once by class 1, and
    // nobody marks them. This is the shape the Make-ups page creates.
    await s.bookMakeup(s.studentId2!, "2029-06-09", {
      homeClassId: s.classId2!,
      classId: s.classId,
    });

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2029-06",
      now: s.now,
    });

    assertEquals(
      res.sealed,
      false,
      "the month must NOT seal — sealing over an unmarked guest makes that lesson permanently unbillable",
    );

    const blockedHere = (res.blocking ?? []).filter(
      (b) => b.class_id === s.classId,
    );
    assertEquals(
      blockedHere.length,
      1,
      "the GUEST-ONLY class is what blocks — not class 2, which is complete",
    );
    assertEquals(
      blockedHere[0].session_date,
      "2029-06-09",
      "and it names the guest's own lesson date",
    );
  } finally {
    await s.teardown();
  }
});

// ── 2. Alone, it still must not seal ────────────────────────────────────────
// Without a second class the old behaviour was survivable — the run reported
// `nothing_to_bill` and the month stayed open. Survivable is not correct: the
// admin was told there was nothing to do, while a lesson was owed a mark.
Deno.test("a guest-only class blocks even when it is the only class with anything in it", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-06") });
  try {
    await emptyTheClass(s, "2029-05-20");
    await s.bookMakeup(s.studentId, "2029-06-09", {
      homeClassId: s.classId,
      classId: s.classId,
    });

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2029-06",
      now: s.now,
    });

    assertEquals(res.sealed, false, "an unmarked guest holds the month open");
    assertEquals(
      (res.blocking ?? []).some((b) => b.session_date === "2029-06-09"),
      true,
      "and the date is reported, so the admin can act on it",
    );
  } finally {
    await s.teardown();
  }
});

// ── 3. The guard still lets an EMPTY class through ──────────────────────────
// The counterweight. A guard that simply stopped skipping classes would make
// every empty class in the tenant expect lessons and block for ever — the
// mirror-image failure, and the one WAVE_1_PLAN.md ranked first overall. A
// class with no enrolments, no sessions AND no bookings must still have no
// bearing on the month.
Deno.test("a class with nothing at all — no enrolments, no sessions, no bookings — still does not block", async () => {
  const s = await newScenario({
    price: 40,
    secondClass: { price: 50 },
    billing: monthEnded("2029-06"),
  });
  try {
    await emptyTheClass(s, "2029-05-20");

    const sess2 = await s.addSession("2029-06-02", s.classId2!);
    await s.mark(sess2, "present", s.studentId2!);
    await s.completeMonth("2029-06", s.classId2!, s.now);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2029-06",
      now: s.now,
    });

    assertEquals(
      (res.blocking ?? []).filter((b) => b.class_id === s.classId).length,
      0,
      "an empty class is not a gap — widening the guard must not widen what BLOCKS",
    );
    assertEquals(res.sealed, true, "and the month completes normally");
  } finally {
    await s.teardown();
  }
});

// ── 4. A MARKED guest in a guest-only class still bills ─────────────────────
// The other half of the fix, and the half that is actually about money. Once
// the class is no longer skipped, a guest who WAS marked must reach billing —
// through `attendedStudentIds`, which is why `billableStudentIds` did not need
// widening (see the prohibition on that guard in core.ts).
Deno.test("a MARKED guest in a class with no active enrolments is billed", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-06") });
  try {
    await emptyTheClass(s, "2029-05-20");
    await s.bookMakeup(s.studentId, "2029-06-09", {
      homeClassId: s.classId,
      classId: s.classId,
    });

    const sess = await s.addSession("2029-06-09");
    await s.mark(sess, "present");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2029-06",
      now: s.now,
    });

    assertEquals(res.sealed, true, "nothing is owed a mark any more");
    const inv = await getInvoice(s.db, s.parentId, "2029-06");
    assertEquals(
      inv!.gross,
      40,
      "the guest's lesson is invoiced at the home class's rate — it used to vanish entirely",
    );
  } finally {
    await s.teardown();
  }
});
