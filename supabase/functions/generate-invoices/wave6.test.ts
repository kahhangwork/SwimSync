// Wave 6 — package lessons draw AT MARKING; the engine bills only ad-hoc lessons.
// docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md §1.2 (engine v33).
//
// With tenants.package_draw_at_marking on, the attendance trigger draws the package
// when a lesson is marked (migration 20261006000100); the engine must (a) never
// bill a drawn lesson, (b) never match packages itself, (c) still seal a month
// whose lessons were all package-funded (D2: optional Generate, 0 invoices),
// (d) not let a drawn earlier month block a later one (ordering guard arm 1),
// (e) behave identically for a business with no packages, and (f) FAIL CLOSED
// when it cannot read which lessons were drawn.
//
// Dates are 2027 on purpose: the D6 guard reads the REAL clock, and lessons after
// today are never "unmarked", so the guard stays out of these engine tests.

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateInvoices } from "./core.ts";
import { newScenario, monthEnded, getInvoice, checkInvariants, type Scenario } from "./test-helpers.ts";

async function sellPackage(
  s: Scenario,
  opts: { lessons: number; rate: number; start: string }
): Promise<string> {
  const { data: prod, error: pErr } = await s.db
    .from("package_products")
    .insert({
      tenant_id: s.tenantId,
      name: `W6 ${opts.lessons} @ ${opts.rate} (${s.tag})`,
      category_id: null,
      lesson_count: opts.lessons,
      rate_per_lesson: opts.rate,
      validity_weeks: 52,
    })
    .select("id")
    .single();
  if (pErr || !prod) throw new Error(`sellPackage product: ${pErr?.message}`);
  const { data, error } = await s.db
    .from("parent_packages")
    .insert({
      tenant_id: s.tenantId,
      parent_id: s.parentId,
      product_id: prod.id,
      status: "active",
      confirmed_at: `${opts.start}T04:00:00Z`,
      start_date: opts.start,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`sellPackage: ${error?.message}`);
  return data.id as string;
}

async function remaining(s: Scenario, pkgId: string): Promise<number> {
  const { data } = await s.db.from("parent_packages").select("value_remaining").eq("id", pkgId).single();
  return Number(data?.value_remaining);
}

async function liveDraws(s: Scenario, pkgId: string): Promise<number> {
  const { data } = await s.db
    .from("package_applications")
    .select("id")
    .eq("parent_package_id", pkgId)
    .is("reversed_at", null);
  return (data ?? []).length;
}

async function isSealed(s: Scenario, month: string): Promise<boolean> {
  const { data } = await s.db
    .from("billing_periods").select("billing_month")
    .eq("tenant_id", s.tenantId).eq("billing_month", month).maybeSingle();
  return data !== null;
}

Deno.test("W6-1: a package-only month issues NO invoice and NO email — and still seals (D2)", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01"), drawAtMarking: true });
  try {
    const pkg = await sellPackage(s, { lessons: 10, rate: 40, start: "2027-01-01" });
    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-09"); await s.mark(b, "present");
    assertEquals(await liveDraws(s, pkg), 2, "the trigger drew both lessons at marking");
    assertEquals(await remaining(s, pkg), 320);
    await s.completeMonth("2027-01");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-01", now: s.now,
    });
    assertEquals(res.invoices_created, 0);
    assertEquals(res.created ?? [], [], "nothing to email");
    assertEquals(await getInvoice(s.db, s.parentId, "2027-01"), null);
    assertEquals(await isSealed(s, "2027-01"), true, "the optional Generate closes the month");
    assertEquals(await remaining(s, pkg), 320, "the engine never draws again");
    assertEquals((await checkInvariants(s.db, s.parentId)).problems, []);
  } finally {
    await s.teardown();
  }
});

Deno.test("W6-2: a mixed family's invoice carries ONLY the ad-hoc lesson, at the class price (D1)", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01"), drawAtMarking: true });
  try {
    const pkg = await sellPackage(s, { lessons: 1, rate: 40, start: "2027-01-01" });
    const a = await s.addSession("2027-01-02"); await s.mark(a, "present"); // drawn
    const b = await s.addSession("2027-01-09"); await s.mark(b, "present"); // exhausted → ad-hoc
    assertEquals(await liveDraws(s, pkg), 1);
    await s.completeMonth("2027-01");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-01", now: s.now,
    });
    assertEquals(res.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assert(inv, "an invoice for the ad-hoc lesson");
    assertEquals(Number(inv.gross), 50);
    assertEquals(Number(inv.package_applied), 0, "the engine matched no package");
    assertEquals(Number(inv.net), 50);
    const { data: lines } = await s.db.from("invoice_items").select("lesson_session_id, amount").eq("invoice_id", inv.id);
    assertEquals(lines?.length, 1);
    assertEquals(lines?.[0].lesson_session_id, b, "the drawn lesson is not on the invoice");
    assertEquals((await checkInvariants(s.db, s.parentId)).problems, []);
  } finally {
    await s.teardown();
  }
});

// ── Ordering guard arm 1 (RISK 3) — one clock for the pair ──────────────────
const CLOCK = new Date("2027-04-08T02:00:00Z");

Deno.test("W6-3: an earlier unsealed month whose present lessons were ALL drawn does not block a later one", async () => {
  const s = await newScenario({ price: 50, enrolledAt: "2027-01-01", drawAtMarking: true });
  try {
    await sellPackage(s, { lessons: 1, rate: 40, start: "2027-01-01" });
    const jan = await s.addSession("2027-01-02"); await s.mark(jan, "present"); // drawn
    await s.completeMonth("2027-01", undefined, CLOCK);
    await s.completeMonth("2027-02", undefined, CLOCK);
    const mar = await s.addSession("2027-03-06"); await s.mark(mar, "present"); // ad-hoc
    await s.completeMonth("2027-03", undefined, CLOCK);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-03", now: CLOCK,
    });
    assertEquals(res.status, "complete — billing month sealed");
    assertEquals(res.invoices_created, 1);
  } finally {
    await s.teardown();
  }
});

Deno.test("W6-4: ...but ONE undrawn present lesson in that earlier month still blocks", async () => {
  const s = await newScenario({ price: 50, enrolledAt: "2027-01-01", drawAtMarking: true });
  try {
    await sellPackage(s, { lessons: 1, rate: 40, start: "2027-01-01" });
    const j1 = await s.addSession("2027-01-02"); await s.mark(j1, "present"); // drawn
    const j2 = await s.addSession("2027-01-09"); await s.mark(j2, "present"); // exhausted → ad-hoc
    await s.completeMonth("2027-01", undefined, CLOCK);
    await s.completeMonth("2027-02", undefined, CLOCK);
    const mar = await s.addSession("2027-03-06"); await s.mark(mar, "present");
    await s.completeMonth("2027-03", undefined, CLOCK);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-03", now: CLOCK,
    });
    assertEquals(res.status, "earlier_month_unbilled");
    assertEquals(res.earlier_unbilled_month, "2027-01");
  } finally {
    await s.teardown();
  }
});

Deno.test("W6-5: AD-HOC PARITY — a business with no packages bills identically with the switch on or off", async () => {
  async function run(on: boolean) {
    const s = await newScenario({ price: 30, billing: monthEnded("2027-01"), drawAtMarking: on });
    try {
      const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
      const b = await s.addSession("2027-01-09"); await s.mark(b, "trial_paid");
      const c = await s.addSession("2027-01-16"); await s.mark(c, "absent");
      await s.completeMonth("2027-01");
      const res = await generateInvoices(s.db, {
        tenant_id: s.tenantId, mode: "manual", billing_month: "2027-01", now: s.now,
      });
      const inv = await getInvoice(s.db, s.parentId, "2027-01");
      const { data: lines } = await s.db.from("invoice_items")
        .select("session_date, amount, attendance_status").eq("invoice_id", inv?.id ?? "")
        .order("session_date");
      return {
        status: res.status, created: res.invoices_created, emails: (res.created ?? []).length,
        gross: Number(inv?.gross), net: Number(inv?.net), pkg: Number(inv?.package_applied),
        lines: (lines ?? []).map((l) => `${l.session_date}:${Number(l.amount)}:${l.attendance_status}`),
      };
    } finally {
      await s.teardown();
    }
  }
  const off = await run(false);
  const on = await run(true);
  assertEquals(on, off);
  assertEquals(off.created, 1);
});

Deno.test("W6-6: FAIL CLOSED — an unreadable drawn set returns package_mode_unreadable, no invoice, no seal", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01"), drawAtMarking: true });
  try {
    const a = await s.addSession("2027-01-02"); await s.mark(a, "present"); // no package: ad-hoc
    await s.completeMonth("2027-01");
    // A client whose package_applications reads fail; every other table is real.
    const broken = new Proxy(s.db, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (table: string) => {
            if (table !== "package_applications") return target.from(table);
            const fail = { data: null, error: { message: "stubbed read failure" } };
            const chain: Record<string, unknown> = {};
            for (const m of ["select", "in", "eq"]) chain[m] = () => chain;
            chain.is = () => Promise.resolve(fail);
            return chain;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as SupabaseClient;

    const res = await generateInvoices(broken, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-01", now: s.now,
    });
    assertEquals(res.status, "package_mode_unreadable");
    assertEquals(res.invoices_created ?? 0, 0);
    assertEquals(await getInvoice(s.db, s.parentId, "2027-01"), null);
    assertEquals(await isSealed(s, "2027-01"), false);
  } finally {
    await s.teardown();
  }
});

Deno.test("W6-7: with the switch on the ENGINE matches no package — a lesson kept ad-hoc is invoiced at the class price", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01"), drawAtMarking: true });
  try {
    // Marked BEFORE the package existed (D5 "Keep as ad-hoc": no backlog draw).
    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const pkg = await sellPackage(s, { lessons: 10, rate: 40, start: "2027-01-01" });
    await s.completeMonth("2027-01");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: "2027-01", now: s.now,
    });
    assertEquals(res.invoices_created, 1);
    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assertEquals(Number(inv?.package_applied), 0);
    assertEquals(Number(inv?.net), 50, "class price, not the package rate");
    assertEquals(await remaining(s, pkg), 400, "the package is untouched");
  } finally {
    await s.teardown();
  }
});
