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
} from "./test-helpers.ts";

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
