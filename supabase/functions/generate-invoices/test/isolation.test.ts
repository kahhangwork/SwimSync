// test/isolation.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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
import { emailCreatedInvoices, retryUnsentInvoiceEmails } from "../domain/emailDelivery.ts";
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
// site. See test/helpers.ts for why (short version: `docs/GOTCHAS.md` §7.25).

// ── Tenant isolation in BILLING ─────────────────────────────────────────────
// The engine runs with the service-role key, which BYPASSES RLS entirely — so
// none of the phase-1 policies protect this path. Isolation here is enforced by
// explicit tenant_id filters in core.ts, and these are the tests that prove it.
// Each fails on a build where any one of those filters is missing.

Deno.test("two tenants bill independently; neither sees the other's lessons", async () => {
  const a = await newScenario({ price: 30, billing: monthEnded("2026-09") });
  const b = await newScenario({ price: 50, billing: monthEnded("2026-09") });
  try {
    const sa = await a.addSession("2026-09-05"); await a.mark(sa, "present");
    await a.completeMonth("2026-09");
    const sb = await b.addSession("2026-09-06"); await b.mark(sb, "present");
    await b.completeMonth("2026-09");

    const resA = await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: false, billing_month: "2026-09", now: a.now });
    assertEquals(resA.invoices_created, 1);
    assertEquals((await getInvoice(a.db, a.parentId, "2026-09"))!.gross, 30);

    const resB = await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: false, billing_month: "2026-09", now: b.now });
    assertEquals(resB.invoices_created, 1);
    assertEquals((await getInvoice(b.db, b.parentId, "2026-09"))!.gross, 50);
  } finally {
    await a.teardown(); await b.teardown();
  }
});

Deno.test("sealing one tenant's month does NOT seal it for another", async () => {
  // billing_periods used to be keyed by billing_month alone, so the first
  // business to finish a month closed it for everyone — every other tenant then
  // short-circuited on already_complete and silently billed nothing.
  const a = await newScenario({ price: 30, billing: monthEnded("2026-10") });
  const b = await newScenario({ price: 40, billing: monthEnded("2026-10") });
  try {
    const sa = await a.addSession("2026-10-03"); await a.mark(sa, "present");
    await a.completeMonth("2026-10");
    const resA = await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: false, billing_month: "2026-10", now: a.now });
    assert(resA.sealed, "tenant A's completed month should seal");

    const sb = await b.addSession("2026-10-03"); await b.mark(sb, "present");
    await b.completeMonth("2026-10");
    const resB = await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: false, billing_month: "2026-10", now: b.now });

    assertEquals(resB.status !== "already_complete", true,
      `tenant B was blocked by tenant A's seal: ${resB.status}`);
    assertEquals(resB.invoices_created, 1);
  } finally {
    await a.teardown(); await b.teardown();
  }
});

Deno.test("one tenant's unmarked lesson does not block another's billing", async () => {
  const a = await newScenario({ price: 30, enrolledAt: "2025-12-01", billing: monthEnded("2026-01") }); // will be blocked
  const b = await newScenario({ price: 40, billing: monthEnded("2026-01") });
  try {
    // Tenant A: a January Saturday with no session at all.
    const sa = await a.addSession("2026-01-03"); await a.mark(sa, "present");

    const sb = await b.addSession("2026-01-10"); await b.mark(sb, "present");
    await b.completeMonth("2026-01");

    const resA = await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: false, billing_month: "2026-01", now: a.now });
    assertEquals(resA.status, "incomplete_attendance");

    const resB = await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: false, billing_month: "2026-01", now: b.now });
    assertEquals(resB.invoices_created, 1, "tenant B must bill despite tenant A being blocked");
  } finally {
    await a.teardown(); await b.teardown();
  }
});

Deno.test("credit earned in one tenant is NOT spendable in another", async () => {
  // The money-model invariant. Drawing a school's credit note against a private
  // coach's invoice would move cash between two unrelated businesses.
  const a = await newScenario({ price: 30, billing: monthEnded("2026-11") });
  const b = await newScenario({ price: 30, billing: monthEnded("2026-11") });
  try {
    // Tenant A: bill, then correct to absent -> $30 credit with tenant A.
    const s1 = await a.addSession("2026-11-07"); await a.mark(s1, "present");
    await a.completeMonth("2026-11");
    await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: true, billing_month: "2026-11", now: a.now });
    await a.mark(s1, "absent");
    assertEquals(await a.tenantCreditBalance(), 30);

    // Same PARENT also deals with tenant B: link them and give them a lesson.
    await b.db.from("parent_tenants")
      .insert({ parent_id: a.parentId, tenant_id: b.tenantId });
    const stu = await b.db.from("students")
      .insert({ full_name: "Cross Kid", assignment_status: "assigned", tenant_id: b.tenantId })
      .select("id").single();
    await b.db.from("parent_students")
      .insert({ parent_id: a.parentId, student_id: stu.data!.id });
    await b.db.from("student_class_enrolments")
      .insert({ student_id: stu.data!.id, class_id: b.classId, is_active: true,
                enrolled_at: "2026-11-01" }); // start at the billing month, not now()

    const s2 = await b.addSession("2026-11-07");
    await b.mark(s2, "present", stu.data!.id);
    await b.mark(s2, "cancelled_rain");     // b's own child, same session
    await b.completeMonth("2026-11");

    const resB = await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: true, billing_month: "2026-11", now: b.now });
    assertEquals(resB.invoices_created, 1);

    // Tenant B's invoice must be billed in FULL — tenant A's credit is not theirs.
    const invB = await getInvoice(b.db, a.parentId, "2026-11", b.tenantId);
    assertEquals(invB!.gross, 30);
    assertEquals(invB!.credit_applied, 0, "tenant A's credit must not touch tenant B's invoice");
    assertEquals(invB!.net, 30);
    // And A's credit is untouched, still waiting for A's next invoice.
    assertEquals(await a.tenantCreditBalance(), 30);
  } finally {
    await b.db.from("parent_tenants").delete().eq("parent_id", a.parentId);
    await b.teardown(); await a.teardown();
  }
});

Deno.test("a parent with children in TWO tenants gets TWO invoices that month", async () => {
  // The user's expected COMMON case (multiple kids, multiple private coaches).
  // UNIQUE (parent_id, billing_month) forbade it outright.
  const a = await newScenario({ price: 30, billing: monthEnded("2026-12") });
  const b = await newScenario({ price: 45, billing: monthEnded("2026-12") });
  try {
    const s1 = await a.addSession("2026-12-05"); await a.mark(s1, "present");
    await a.completeMonth("2026-12");

    await b.db.from("parent_tenants")
      .insert({ parent_id: a.parentId, tenant_id: b.tenantId });
    const stu = await b.db.from("students")
      .insert({ full_name: "Sibling", assignment_status: "assigned", tenant_id: b.tenantId })
      .select("id").single();
    await b.db.from("parent_students")
      .insert({ parent_id: a.parentId, student_id: stu.data!.id });
    await b.db.from("student_class_enrolments")
      .insert({ student_id: stu.data!.id, class_id: b.classId, is_active: true,
                enrolled_at: "2026-12-01" }); // start at the billing month, not now()
    const s2 = await b.addSession("2026-12-06");
    await b.mark(s2, "present", stu.data!.id);
    await b.mark(s2, "cancelled_rain");     // b's own child, same session
    await b.completeMonth("2026-12");

    await generateInvoices(a.db, {
      tenant_id: a.tenantId, mode: "manual", force: true, billing_month: "2026-12", now: a.now });
    await generateInvoices(b.db, {
      tenant_id: b.tenantId, mode: "manual", force: true, billing_month: "2026-12", now: b.now });

    const { data: invs } = await a.db
      .from("invoices")
      .select("tenant_id, gross_amount")
      .eq("parent_id", a.parentId)
      .eq("billing_month", "2026-12");

    assertEquals(invs!.length, 2, "one invoice per business, not one in total");
    const byTenant = Object.fromEntries(
      invs!.map((i) => [i.tenant_id, Number(i.gross_amount)])
    );
    assertEquals(byTenant[a.tenantId], 30);
    assertEquals(byTenant[b.tenantId], 45);
  } finally {
    await b.db.from("parent_tenants").delete().eq("parent_id", a.parentId);
    await b.teardown(); await a.teardown();
  }
});

Deno.test("credit note references are numbered PER TENANT, both from 0001", async () => {
  // A global sequence made a school's third note read CN-2026-0047, and the
  // gaps told them exactly how many notes every other business had issued in
  // between. Each tenant now numbers its own.
  const a = await newScenario({ price: 30, billing: monthEnded("2027-02") });
  const b = await newScenario({ price: 30, billing: monthEnded("2027-02") });
  try {
    for (const s of [a, b]) {
      const sess = await s.addSession("2027-02-06");
      await s.mark(sess, "present");
      await s.completeMonth("2027-02");
      await generateInvoices(s.db, {
        tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2027-02", now: s.now });
      await s.mark(sess, "absent"); // -> credit note
    }

    const refFor = async (s: typeof a) => {
      const { data } = await s.db
        .from("credit_notes")
        .select("reference_number")
        .eq("tenant_id", s.tenantId)
        .single();
      return data!.reference_number as string;
    };

    const refA = await refFor(a);
    const refB = await refFor(b);

    // Both are their tenant's FIRST note, so both end 0001 — which a global
    // UNIQUE on reference_number would have rejected outright.
    assert(refA.endsWith("-0001"), `tenant A got ${refA}`);
    assert(refB.endsWith("-0001"), `tenant B got ${refB}`);
  } finally {
    await a.teardown(); await b.teardown();
  }
});
