// Advance-cancelled lessons (cancel_lesson, 20260821000700) and the completeness
// gate — docs/plans/UPCOMING_LESSONS_COMPLETE_PLAN.md Phase B, Step B2.
//
// A cancelled session expects nobody who is merely ENROLLED: the engine subtracts
// the date from `expectedDates` (the weekday PROJECTION) and `unmarkedOn()`
// withholds the enrolment spans for it. Nothing else changes — and THAT is what
// this file pins, in both directions:
//
//   ⚠ RISK 1 — the prohibition. Cancelled dates may be subtracted ONLY from
//   `expectedDates`, never from the `sessionByDate` / `bookingsByDate` terms of
//   `datesToCheck`. The second test is the pin: a cancelled date that ALSO holds
//   a live make-up booking must BLOCK the month (`incomplete_attendance`), never
//   seal over the guest. cancel_lesson() refuses to create that state; the
//   engine must not depend on it (§7.18's shape — the guard that sealed over a
//   guest-only class was exactly this, one axis over).
//
//   "The engine does not depend on B1" — the third test writes `present` rows
//   onto a cancelled session (impossible through the product: the trigger
//   refuses) and asserts they still bill. Billing follows attendance rows that
//   exist, always (core.ts §"Who gets BILLED").
//
// Sessions are written DIRECTLY as service_role (the RPC gates on auth.uid(),
// and guard_session_date exempts a definer/service writer), the same way
// bookTrial/bookMakeup are written. The CHECK `lesson_sessions_cancel_coherent`
// means status='cancelled' must accompany cancelled_at.
//
// The scenario class runs on SATURDAY. February 2029's Saturdays: 3, 10, 17, 24.
// Run the suite TWICE (§7.15): a completing run seals its month.

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateInvoices } from "./core.ts";
import {
  newScenario,
  monthEnded,
  getInvoice,
  type Scenario,
} from "./test-helpers.ts";

const MONTH = "2029-02";
const SATS = ["2029-02-03", "2029-02-10", "2029-02-17"] as const;
const CANCELLED = "2029-02-24";

/** Write a cancelled session for `date` the way cancel_lesson() leaves it. */
async function cancelSession(
  s: Scenario,
  date: string,
  classId?: string
): Promise<string> {
  const { data, error } = await s.db
    .from("lesson_sessions")
    .insert({
      class_id: classId ?? s.classId,
      session_date: date,
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: s.coachProfileId,
      cancellation_reason: `test cancel ${s.tag}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`cancelSession: ${error?.message}`);
  return data.id as string;
}

/** Remove a session this file wrote outside the scenario's own tracking. */
async function dropSession(s: Scenario, id: string) {
  await s.db.from("attendance").delete().eq("lesson_session_id", id);
  await s.db.from("lesson_sessions").delete().eq("id", id);
}

/** A second class in the SAME category (a make-up host/home pair must share
 *  one), as makeups.test.ts builds it. */
async function addHomeClass(s: Scenario, dayOfWeek = "sunday"): Promise<string> {
  const { data, error } = await s.db
    .from("classes")
    .insert({
      coach_id: s.coachId,
      title: `Home ${s.tag}`,
      day_of_week: dayOfWeek,
      start_time: "10:00",
      end_time: "11:00",
      location_name: "Test Pool",
      price_per_lesson: 30,
      category_id: s.categoryId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addHomeClass: ${error?.message}`);
  return data.id as string;
}

Deno.test("cancelled lesson: a cancelled date with nothing on it neither blocks nor bills", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded(MONTH) });
  let cancelled: string | null = null;
  try {
    for (const d of SATS) {
      const id = await s.addSession(d);
      await s.mark(id, "present");
    }
    // The 24th: no session, no marks — WITHOUT the cancel this is exactly the
    // "lesson nobody touched" that blocks the month (core.test "BLOCKS a lesson
    // date that has no session row at all").
    const blocked = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: false, billing_month: MONTH, now: s.now });
    assertEquals(blocked.status, "incomplete_attendance", "control: the untouched 24th blocks");
    assertEquals(blocked.blocking![0].session_date, CANCELLED);

    cancelled = await cancelSession(s, CANCELLED);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: false, billing_month: MONTH, now: s.now });
    assert(res.status !== "incomplete_attendance", "the cancelled 24th no longer blocks");
    assertEquals(res.invoices_created, 1);
    assert(res.sealed, "a month whose only gap is a cancelled lesson is complete, and seals");
    const inv = await getInvoice(s.db, s.parentId, MONTH);
    assertEquals(inv!.gross, 90, "three lessons billed; the cancelled one bills nothing");
  } finally {
    if (cancelled) await dropSession(s, cancelled);
    await s.teardown();
  }
});

Deno.test("⚠ RISK 1: a cancelled date that ALSO holds a live make-up booking BLOCKS the month — never sealed over", async () => {
  // Two classes, same category: the scenario's Saturday class HOSTS, a Sunday
  // class is the guest's HOME. The guest is booked into the host on the 24th,
  // and the 24th is cancelled. The booking is evidence a named child was
  // expected on a named date; the cancel must not erase it from the gate.
  const s = await newScenario({ price: 30, billing: monthEnded(MONTH) });
  let cancelled: string | null = null;
  let homeClassId: string | null = null;
  let guest: string | null = null;
  try {
    for (const d of SATS) {
      const id = await s.addSession(d);
      await s.mark(id, "present");
    }
    homeClassId = await addHomeClass(s);
    guest = await s.addUnclaimedStudent({ name: `Guest ${s.tag}`, classId: homeClassId, enrolment: "ongoing" });
    // The home class's own February must be complete, or IT is what blocks.
    await s.completeMonth(MONTH, homeClassId);

    cancelled = await cancelSession(s, CANCELLED);
    await s.bookMakeup(guest, CANCELLED, { homeClassId, classId: s.classId });

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: MONTH, now: s.now });
    assertEquals(res.status, "incomplete_attendance",
      "a live guest on a cancelled date is an unmarked expected child — the month must BLOCK");
    assertEquals(res.invoices_created, 0);
    assert(!res.sealed, "and it must not seal (a sealed month's lesson can never be billed, §11.6)");
    const hit = (res.blocking ?? []).find((b) => b.class_id === s.classId && b.session_date === CANCELLED);
    assert(hit, "the block names the host class on the cancelled date");
    assertEquals(hit!.unmarked_student_count, 1, "exactly the guest — the enrolled child is NOT expected at a cancelled lesson");
  } finally {
    if (guest) {
      await s.db.from("makeup_bookings").delete().eq("student_id", guest);
    }
    if (cancelled) await dropSession(s, cancelled);
    await s.teardown();
    if (homeClassId) {
      // Scenario teardown does not know this class; clear what hangs off it.
      await s.db.from("attendance").delete().in(
        "lesson_session_id",
        ((await s.db.from("lesson_sessions").select("id").eq("class_id", homeClassId)).data ?? []).map((r) => r.id)
      );
      await s.db.from("lesson_sessions").delete().eq("class_id", homeClassId);
      await s.db.from("student_class_enrolments").delete().eq("class_id", homeClassId);
      await s.db.from("class_rates").delete().eq("class_id", homeClassId);
      await s.db.from("classes").delete().eq("id", homeClassId);
      if (guest) await s.db.from("students").delete().eq("id", guest);
    }
  }
});

Deno.test("the engine does not depend on B1: attendance rows on a cancelled session still bill", async () => {
  // Unreachable through the product (guard_attendance_date refuses a new mark
  // on a cancelled session), written here as service_role to prove billing
  // follows the rows that exist. A cancel must never delete billed reality.
  const s = await newScenario({ price: 30, billing: monthEnded(MONTH) });
  let cancelled: string | null = null;
  try {
    for (const d of SATS) {
      const id = await s.addSession(d);
      await s.mark(id, "present");
    }
    cancelled = await cancelSession(s, CANCELLED);
    await s.mark(cancelled, "present");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: false, billing_month: MONTH, now: s.now });
    assert(res.status !== "incomplete_attendance", "nothing blocks: every expected child is marked");
    assertEquals(res.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, MONTH);
    assertEquals(inv!.gross, 120, "all four present rows bill, the cancel flag notwithstanding");
  } finally {
    if (cancelled) await dropSession(s, cancelled);
    await s.teardown();
  }
});
