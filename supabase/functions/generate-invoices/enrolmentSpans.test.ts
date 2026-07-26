// WHO WAS EXPECTED AT A LESSON IS A QUESTION ABOUT THAT LESSON'S DATE.
//
// The completeness gate used to ask "who is actively enrolled?" — one set for
// a whole month — and expect those students at EVERY lesson in it. That is
// wrong for anyone whose enrolment does not span the month:
//
//   A child enrolled on 20 June was expected at the 6 June and 13 June lessons
//   too. They have no attendance rows there, so the month reports
//   incomplete_attendance — and unmarked attendance BLOCKS generation entirely,
//   with no override (§8a). The only way to clear it was to mark a child at a
//   lesson they were not enrolled for.
//
// The window floor (core.ts) is the class's EARLIEST enrolment, which protects
// a brand-new class but does nothing for a later joiner into an established
// one. That is the case these tests pin.
//
// WHY THIS IS A BILLING TEST AND NOT A UI ONE. The same un-dated set drove the
// coach's roster, and fixing only the roster would be WORSE than fixing
// neither: the engine would still name a lesson as unmarked while the app
// correctly no longer offered any way to mark it — a month unbillable with no
// remedy in the product. §7.18's shape, where the client and the engine
// disagree about what "marked" means.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateInvoices } from "./core.ts";
import { getInvoice, monthEnded, newScenario, type Scenario } from "./test-helpers.ts";

/**
 * A second child of the SAME parent, enrolled on a given date.
 *
 * Written inline rather than through addUnclaimedStudent() because that helper
 * deliberately creates a child with NO parent — an unclaimed child holds the
 * month open on its own (§8.10), which would mask the very thing under test.
 * teardown() sweeps by tenant, so strays added this way are cleaned up.
 */
async function addJoiner(
  s: Scenario,
  opts: { name: string; enrolledAt: string; unenrolledAt?: string }
): Promise<string> {
  const { data: student, error } = await s.db
    .from("students")
    .insert({
      full_name: opts.name,
      tenant_id: s.tenantId,
      assignment_status: "assigned",
    })
    .select("id")
    .single();
  if (error || !student) throw new Error(`addJoiner: ${error?.message}`);

  const { error: psErr } = await s.db
    .from("parent_students")
    .insert({ parent_id: s.parentId, student_id: student.id });
  if (psErr) throw new Error(`addJoiner link: ${psErr.message}`);

  const { error: eErr } = await s.db.from("student_class_enrolments").insert({
    student_id: student.id,
    class_id: s.classId,
    enrolled_at: opts.enrolledAt,
    unenrolled_at: opts.unenrolledAt ?? null,
    is_active: !opts.unenrolledAt,
  });
  if (eErr) throw new Error(`addJoiner enrolment: ${eErr.message}`);

  return student.id as string;
}

// ── The one that discriminates ──────────────────────────────────────────────
// FAILS on the pre-fix engine with status "incomplete_attendance", naming
// 2026-04-04 and 2026-04-11 as blocking. That failure IS the bug.

Deno.test("a child who joins mid-month does not block the month", async () => {
  const s = await newScenario({ billing: monthEnded("2026-04") });
  try {
    // April 2026 Saturdays: 4, 11, 18, 25.
    const w1 = await s.addSession("2026-04-04");
    const w2 = await s.addSession("2026-04-11");
    const w3 = await s.addSession("2026-04-18");
    const w4 = await s.addSession("2026-04-25");

    // The child who was there all month.
    for (const sess of [w1, w2, w3, w4]) await s.mark(sess, "present");

    // The child who joined on the 15th — after the first two lessons had
    // already happened. They are marked at every lesson they were enrolled
    // for, and at none that they were not. Nothing is missing here.
    const joiner = await addJoiner(s, {
      name: "Joined Mid Month",
      enrolledAt: "2026-04-15",
    });
    await s.mark(w3, "present", joiner);
    await s.mark(w4, "present", joiner);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2026-04",
      now: s.now,
    });

    assertEquals(res.status, "complete — billing month sealed");
    assertEquals(res.invoices_created, 1);

    // One invoice per parent: four lessons for the first child, two for the
    // joiner, at $30 each.
    const inv = await getInvoice(s.db, s.parentId, "2026-04");
    assertEquals(inv!.gross, 180);
  } finally {
    await s.teardown();
  }
});

// ── The mirror case ─────────────────────────────────────────────────────────
// REGRESSION GUARD, NOT A DISCRIMINATOR: this passes on the pre-fix engine
// too, because activeStudentIds already filtered on is_active and a departed
// child was therefore excluded from every lesson. It is here so that moving to
// spans — which reinstates a departed child for the dates they WERE enrolled —
// cannot quietly start demanding rows after they left. Stated plainly rather
// than left for someone to discover it proves nothing (§7.25).

Deno.test("a child who leaves mid-month is not expected at later lessons", async () => {
  const s = await newScenario({ billing: monthEnded("2026-05") });
  try {
    // May 2026 Saturdays: 2, 9, 16, 23, 30 — ALL FIVE. A lesson with no session
    // row is UNMARKED, not absent (sessions are created lazily, PRD §7.5), so
    // omitting the last two would report the month incomplete for a reason that
    // has nothing to do with the leaver. The first draft of this test did
    // exactly that and failed for the wrong reason.
    const w1 = await s.addSession("2026-05-02");
    const w2 = await s.addSession("2026-05-09");
    const w3 = await s.addSession("2026-05-16");
    const w4 = await s.addSession("2026-05-23");
    const w5 = await s.addSession("2026-05-30");

    for (const sess of [w1, w2, w3, w4, w5]) await s.mark(sess, "present");

    const leaver = await addJoiner(s, {
      name: "Left Mid Month",
      enrolledAt: "2026-04-01",
      unenrolledAt: "2026-05-10",
    });
    // Marked for the two lessons they were there for, and nothing after.
    await s.mark(w1, "present", leaver);
    await s.mark(w2, "present", leaver);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2026-05",
      now: s.now,
    });

    assertEquals(res.status, "complete — billing month sealed");
    // Billing follows ATTENDANCE ROWS, not enrolment (§7.13) — the leaver's two
    // lessons still bill even though they have left. 5 + 2 lessons at $30.
    const inv = await getInvoice(s.db, s.parentId, "2026-05");
    assertEquals(inv!.gross, 210);
  } finally {
    await s.teardown();
  }
});

// ── The tripwire ────────────────────────────────────────────────────────────
// The same shape as packages.test.ts's no-package test. A scenario with no
// joiners and no leavers must bill EXACTLY as it did before spans existed —
// this is the only check that would catch "the span filter changed billing for
// everyone", which no targeted test above would notice.

Deno.test("TRIPWIRE: an ordinary month with no joiners bills byte-identically", async () => {
  const s = await newScenario({ billing: monthEnded("2026-06") });
  try {
    // June 2026 Saturdays: 6, 13, 20, 27.
    const sessions = [];
    for (const d of ["2026-06-06", "2026-06-13", "2026-06-20", "2026-06-27"]) {
      sessions.push(await s.addSession(d));
    }
    await s.mark(sessions[0], "present");
    await s.mark(sessions[1], "absent");
    await s.mark(sessions[2], "present");
    await s.mark(sessions[3], "cancelled_rain");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      billing_month: "2026-06",
      now: s.now,
    });

    assertEquals(res.status, "complete — billing month sealed");
    assertEquals(res.invoices_created, 1);
    assertEquals(res.parents_deferred, 0);

    // Two billable lessons: absent and cancelled_rain are not billable
    // (PRD 5.4, gotcha §7.5).
    const inv = await getInvoice(s.db, s.parentId, "2026-06");
    assertEquals(inv!.gross, 60);
    assertEquals(inv!.credit_applied, 0);
    assertEquals(inv!.net, 60);
  } finally {
    await s.teardown();
  }
});
