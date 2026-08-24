// Make-up bookings: a child guests into ONE lesson of another same-category
// class (MAKEUP_CLASSES_PLAN — the guest-pass model).
//
// Two things are under test, and they fail in opposite directions, exactly as
// trials did:
//
//   BLOCKING — a booked make-up child is expected at exactly ONE lesson of the
//   host class. Expect them at every lesson and the month never closes; expect
//   them at none and a forgotten make-up is silently never billed (a lost
//   package draw or lost ad-hoc revenue).
//
//   PRICING — an ad-hoc make-up guest pays their HOME class's effective-dated
//   rate on the lesson's own date, never the host class's. A package family
//   draws at the package's locked rate against the category SNAPSHOTTED on the
//   booking (§7.45 — classes.category_id is mutable and money depends on it).
//
// The class weekday defaults to SATURDAY, so host-class dates below are
// Saturdays; the second class runs SUNDAY.

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateInvoices } from "./core.ts";
import {
  newScenario,
  monthEnded,
  getInvoice,
  checkInvariants,
  type Scenario,
} from "./test-helpers.ts";

// ── Local fixtures ──────────────────────────────────────────────────────────

/** A second class in the SAME category as the scenario's (the host), so a
 *  same-category make-up between the two is expressible. The scenario's own
 *  `secondClass` deliberately uses a different category, so it cannot serve. */
async function addHomeClass(
  s: Scenario,
  opts: { price: number; dayOfWeek?: string }
): Promise<string> {
  const { data, error } = await s.db
    .from("classes")
    .insert({
      coach_id: s.coachId,
      title: `Home ${s.tag}`,
      day_of_week: opts.dayOfWeek ?? "sunday",
      start_time: "10:00",
      end_time: "11:00",
      location_id: s.locationId,
      price_per_lesson: opts.price,
      category_id: s.categoryId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addHomeClass: ${error?.message}`);
  return data.id as string;
}

/** An enrolled, CLAIMED child in `classId` — the make-up candidate. */
async function addGuestKid(s: Scenario, classId: string): Promise<string> {
  const kid = await s.addUnclaimedStudent({
    name: `Guest ${s.tag}`,
    classId,
    enrolment: "ongoing",
  });
  await s.db.from("parent_students").insert({
    parent_id: s.parentId,
    student_id: kid,
  });
  return kid;
}

async function addProduct(
  s: Scenario,
  opts: { lessons: number; rate: number; categoryId?: string | null }
): Promise<string> {
  const { data, error } = await s.db
    .from("package_products")
    .insert({
      tenant_id: s.tenantId,
      name: `${opts.lessons} lessons @ ${opts.rate} (${s.tag})`,
      category_id: opts.categoryId ?? null,
      lesson_count: opts.lessons,
      rate_per_lesson: opts.rate,
      validity_months: 12,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addProduct: ${error?.message}`);
  return data.id as string;
}

async function buyPackage(
  s: Scenario,
  productId: string,
  confirmedAt: string
): Promise<string> {
  const { data, error } = await s.db
    .from("parent_packages")
    .insert({
      tenant_id: s.tenantId,
      parent_id: s.parentId,
      product_id: productId,
      status: "active",
      confirmed_at: confirmedAt,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`buyPackage: ${error?.message}`);
  return data.id as string;
}

// ── THE TRIPWIRE (⚠ RISK 1) ─────────────────────────────────────────────────
// Written FIRST and recorded green against the UNMODIFIED v16 engine. Every
// make-up change must keep it green: a tenant with zero make-up bookings
// produces exactly the invoice it produced before the feature existed.

Deno.test("TRIPWIRE (⚠ RISK 1): with NO make-up bookings the invoice is byte-identical to the pre-makeup engine", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2029-01") });
  try {
    const a = await s.addSession("2029-01-06");
    await s.mark(a, "present");
    const b = await s.addSession("2029-01-13");
    await s.mark(b, "present");
    await s.completeMonth("2029-01");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2029-01",
      now: s.now,
    });
    assertEquals(res.invoices_created, 1);
    assertEquals(res.sealed, true);

    const inv = await getInvoice(s.db, s.parentId, "2029-01");
    assertEquals(inv!.gross, 60, "2 lessons × the class's own $30 — nothing repriced");
    assertEquals(inv!.package_applied, 0);
    assertEquals(inv!.credit_applied, 0);
    assertEquals(inv!.net, 60);
    assertEquals(inv!.status, "outstanding");

    const { data: items } = await s.db
      .from("invoice_items")
      .select("class_title, amount")
      .eq("invoice_id", inv!.id);
    assertEquals((items ?? []).length, 2, "exactly the two lessons, no extra lines");
    for (const it of items ?? []) {
      assertEquals(Number(it.amount), 30);
      assert(
        !String(it.class_title).includes("(make-up)"),
        "no line may carry the make-up marker when nothing was booked"
      );
    }

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

// ── BLOCKING ────────────────────────────────────────────────────────────────

Deno.test("an unmarked make-up blocks the month, exactly like a trial", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-02") });
  try {
    const sess = await s.addSession("2029-02-03");
    await s.mark(sess, "present");
    const kid = await s.addUnclaimedStudent({ name: "Mk Block", enrolment: "none" });
    await s.bookMakeup(kid, "2029-02-03", { homeClassId: s.classId });
    await s.completeMonth("2029-02");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-02", now: s.now,
    });

    assertEquals(res.sealed, false, "an unmarked make-up holds the month open");
    assertEquals(res.status, "incomplete_attendance");
  } finally {
    await s.teardown();
  }
});

Deno.test("a CANCELLED make-up expects nobody — the month seals normally", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-03") });
  try {
    const sess = await s.addSession("2029-03-03");
    await s.mark(sess, "present");
    const kid = await s.addUnclaimedStudent({ name: "Mk Cancelled", enrolment: "none" });
    const booking = await s.bookMakeup(kid, "2029-03-03", { homeClassId: s.classId });
    await s.db
      .from("makeup_bookings")
      .update({ cancelled_at: new Date(0).toISOString(), cancelled_by: s.coachProfileId })
      .eq("id", booking);
    await s.completeMonth("2029-03");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-03", now: s.now,
    });

    assertEquals(res.sealed, true, "a cancelled booking does not hold the month open");
  } finally {
    await s.teardown();
  }
});

Deno.test("a make-up on a date with NO session still blocks (the datesToCheck union)", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-04") });
  try {
    const sess = await s.addSession("2029-04-07");
    await s.mark(sess, "present");
    const kid = await s.addUnclaimedStudent({ name: "Mk NoSession", enrolment: "none" });
    // A SUNDAY — the saturday host class has no session there and completeMonth
    // will not create one. Only the booking-date union can see it.
    await s.bookMakeup(kid, "2029-04-08", { homeClassId: s.classId });
    await s.completeMonth("2029-04");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-04", now: s.now,
    });

    assertEquals(res.sealed, false, "a booking on a session-less date must still block");
    assertEquals(res.status, "incomplete_attendance");
  } finally {
    await s.teardown();
  }
});

// ── PRICING ─────────────────────────────────────────────────────────────────

Deno.test("an ad-hoc guest bills at their HOME class's rate, and the line says (make-up)", async () => {
  // Host $40 (saturday), home $35 (sunday), same category.
  const s = await newScenario({ price: 40, billing: monthEnded("2029-05") });
  try {
    const home = await addHomeClass(s, { price: 35 });
    const kid = await addGuestKid(s, home);

    const sess = await s.addSession("2029-05-05");
    await s.mark(sess, "present");            // the host's own student, $40
    await s.mark(sess, "present", kid);       // the guest
    await s.bookMakeup(kid, "2029-05-05", { homeClassId: home });
    await s.completeMonth("2029-05");
    await s.completeMonth("2029-05", home);

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-05", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2029-05");
    assertEquals(inv!.gross, 75, "40 (member) + 35 (guest at the HOME rate, not 40)");

    const { data: items } = await s.db
      .from("invoice_items")
      .select("class_title, amount, student_id")
      .eq("invoice_id", inv!.id);
    const guestLine = (items ?? []).find((i) => i.student_id === kid);
    assertEquals(Number(guestLine!.amount), 35);
    assert(
      String(guestLine!.class_title).endsWith("(make-up)"),
      `the guest line explains itself: got "${guestLine!.class_title}"`
    );
    const memberLine = (items ?? []).find((i) => i.student_id === s.studentId);
    assert(
      !String(memberLine!.class_title).includes("(make-up)"),
      "the member's line carries no marker"
    );
  } finally {
    await s.teardown();
  }
});

Deno.test("the home rate is EFFECTIVE-DATED: a raise after the make-up date does not touch it", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-06") });
  try {
    const home = await addHomeClass(s, { price: 35 });
    const kid = await addGuestKid(s, home);

    // Raised from the 20th; the make-up is on the 2nd.
    await s.setRate({ from: "2029-06-20", price: 99, classId: home });

    const sess = await s.addSession("2029-06-02");
    await s.mark(sess, "present");
    await s.mark(sess, "present", kid);
    await s.bookMakeup(kid, "2029-06-02", { homeClassId: home });
    await s.completeMonth("2029-06");
    await s.completeMonth("2029-06", home);

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-06", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2029-06");
    assertEquals(inv!.gross, 75, "the rate in force ON THE LESSON'S DATE — 35, not 99");
  } finally {
    await s.teardown();
  }
});

Deno.test("⚠ THE SNAPSHOT TEST: a package draws for the make-up even after the HOST class is re-tagged", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-07") });
  try {
    const home = await addHomeClass(s, { price: 35 });
    const kid = await addGuestKid(s, home);
    const productId = await addProduct(s, {
      lessons: 10, rate: 30, categoryId: s.categoryId,
    });
    const pkgId = await buyPackage(s, productId, "2029-06-01T04:00:00Z");

    const sess = await s.addSession("2029-07-07");
    await s.mark(sess, "present");
    await s.mark(sess, "present", kid);
    await s.bookMakeup(kid, "2029-07-07", { homeClassId: home });

    // The admin re-tags the HOST class after the booking. The booking's
    // category snapshot must keep the draw; the member's own lesson follows
    // the live category and correctly stops matching.
    await s.db
      .from("classes")
      .update({ category_id: s.categoryId2 })
      .eq("id", s.classId);

    await s.completeMonth("2029-07");
    await s.completeMonth("2029-07", home);

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-07", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2029-07");
    assertEquals(inv!.gross, 70, "40 (member, now uncovered) + 30 (guest at the LOCKED package rate)");
    assertEquals(inv!.package_applied, 30, "exactly the guest's line drew");
    assertEquals(inv!.net, 40);

    const { data: pkg } = await s.db
      .from("parent_packages").select("value_remaining").eq("id", pkgId).single();
    assertEquals(Number(pkg!.value_remaining), 270, "300 − one locked-rate draw");

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("a guest who does not turn up bills NOTHING, and the month closes", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-08") });
  try {
    const home = await addHomeClass(s, { price: 35 });
    const kid = await addGuestKid(s, home);

    const sess = await s.addSession("2029-08-04");
    await s.mark(sess, "present");
    await s.mark(sess, "absent", kid);   // the no-show
    await s.bookMakeup(kid, "2029-08-04", { homeClassId: home });
    await s.completeMonth("2029-08");
    await s.completeMonth("2029-08", home);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-08", now: s.now,
    });

    assertEquals(res.sealed, true, "a marked no-show satisfies the gate");
    const inv = await getInvoice(s.db, s.parentId, "2029-08");
    assertEquals(inv!.gross, 40, "only the member's lesson — an absent guest is $0");
  } finally {
    await s.teardown();
  }
});

Deno.test("unenrolled after booking + home class DEACTIVATED: still bills at the snapshot home rate", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-09") });
  try {
    const home = await addHomeClass(s, { price: 35 });
    const kid = await addGuestKid(s, home);

    const sess = await s.addSession("2029-09-01");
    await s.mark(sess, "present");
    await s.mark(sess, "present", kid);
    await s.bookMakeup(kid, "2029-09-01", { homeClassId: home });
    await s.completeMonth("2029-09");
    await s.completeMonth("2029-09", home);

    // The family leaves and the home class is retired.
    //
    // THIS NO LONGER PINS THE RATES FETCH, and the comment that said it did was
    // removed rather than left to mislead. It pinned the `home_class_id` arm of
    // the class_rates .in() ONLY because deactivating the home class was what
    // dropped it out of the classes scan; since 2026-08-09 that scan is not
    // filtered by is_active, the arm was unreachable, and it was deleted
    // (core.ts). Measured: with the arm still present, deleting it left this
    // whole file passing 12/12.
    //
    // What it pins now is the SNAPSHOT: a guest whose enrolment has closed and
    // whose home class has been retired still bills at that home class's
    // effective-dated rate. Both of those are ordinary end-of-term states, so
    // this case is worth keeping on its own terms.
    await s.db
      .from("student_class_enrolments")
      .update({ is_active: false, unenrolled_at: new Date().toISOString() })
      .eq("student_id", kid);
    await s.db.from("classes").update({ is_active: false }).eq("id", home);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-09", now: s.now,
    });

    assertEquals(res.sealed, true, "the run survives a deactivated home class");
    const inv = await getInvoice(s.db, s.parentId, "2029-09");
    assertEquals(inv!.gross, 75, "40 (member) + 35 (guest, snapshot home rate)");
  } finally {
    await s.teardown();
  }
});

Deno.test("a make-up into an admin-scheduled OFF-SCHEDULE session bills and gates", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-10") });
  try {
    const home = await addHomeClass(s, { price: 35 });
    const kid = await addGuestKid(s, home);

    // An extra host lesson on a WEDNESDAY (schedule_extra_lesson's shape;
    // service_role bypasses the client guard exactly as the RPC does).
    const { data: extra, error } = await s.db
      .from("lesson_sessions")
      .insert({
        class_id: s.classId,
        session_date: "2029-10-03",
        status: "completed",
        off_schedule_reason: "holiday shift",
      })
      .select("id")
      .single();
    if (error || !extra) throw new Error(`extra session: ${error?.message}`);

    // The session exists, so EVERY enrolled student is expected at it — the
    // member must be marked too, not just the guest.
    await s.mark(extra.id as string, "present");
    await s.mark(extra.id as string, "present", kid);
    await s.bookMakeup(kid, "2029-10-03", { homeClassId: home });
    await s.completeMonth("2029-10");
    await s.completeMonth("2029-10", home);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-10", now: s.now,
    });

    assertEquals(res.sealed, true);
    const inv = await getInvoice(s.db, s.parentId, "2029-10");
    assertEquals(inv!.gross, 75, "40 (member, extra lesson) + 35 (guest at home rate)");
  } finally {
    await s.teardown();
  }
});

// ⚠ RISK 5 — the SQL simulation and the engine must not drift.
Deno.test("package_live_balances() predicts a make-up draw EXACTLY, even after a host re-tag", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-11") });
  try {
    const home = await addHomeClass(s, { price: 35 });
    const kid = await addGuestKid(s, home);
    const productId = await addProduct(s, {
      lessons: 10, rate: 30, categoryId: s.categoryId,
    });
    const pkgId = await buyPackage(s, productId, "2029-10-01T04:00:00Z");

    const sess = await s.addSession("2029-11-03");
    await s.mark(sess, "present");
    await s.mark(sess, "present", kid);
    await s.bookMakeup(kid, "2029-11-03", { homeClassId: home });
    await s.db
      .from("classes")
      .update({ category_id: s.categoryId2 })
      .eq("id", s.classId);
    await s.completeMonth("2029-11");
    await s.completeMonth("2029-11", home);

    // The PREDICTION, before any invoice exists.
    const { data: pred } = await s.db.rpc("package_live_balances");
    const mine = (pred ?? []).find(
      (r: { parent_package_id: string }) => r.parent_package_id === pkgId
    );
    assertEquals(Number(mine!.live_value_remaining), 270,
      "the simulation sees the pending make-up draw through the booking's snapshot");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-11", now: s.now,
    });

    // The SETTLEMENT equals the prediction.
    const { data: pkg } = await s.db
      .from("parent_packages").select("value_remaining").eq("id", pkgId).single();
    assertEquals(Number(pkg!.value_remaining), 270, "prediction == settlement");
  } finally {
    await s.teardown();
  }
});

// Enrolment wins over a booking: a member is not a guest.
Deno.test("a child ENROLLED in the host class prices as a member despite a stray booking", async () => {
  const s = await newScenario({ price: 40, billing: monthEnded("2029-12") });
  try {
    const home = await addHomeClass(s, { price: 35 });
    // The scenario's own student IS enrolled in the host class; give them a
    // (nonsensical but possible) make-up booking into it.
    const sess = await s.addSession("2029-12-01");
    await s.mark(sess, "present");
    await s.bookMakeup(s.studentId, "2029-12-01", { homeClassId: home });
    await s.completeMonth("2029-12");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2029-12", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2029-12");
    assertEquals(inv!.gross, 40, "the HOST rate — enrolment wins over the booking");

    const { data: items } = await s.db
      .from("invoice_items").select("class_title").eq("invoice_id", inv!.id);
    assert(
      (items ?? []).every((i) => !String(i.class_title).includes("(make-up)")),
      "no line carries the marker — the child is a member on that date"
    );
  } finally {
    await s.teardown();
  }
});
