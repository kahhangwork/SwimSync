// Prepaid lesson packages — engine integration tests (PACKAGES_DESIGN.md §3).
//
// What is pinned here:
//   • THE TRIPWIRE: a parent with no package produces exactly the invoice
//     they always did (⚠ RISK 1 — package logic must not leak into the
//     ad-hoc path). This is a regression guard by design: it passes on the
//     pre-package engine too, and that is the claim it makes.
//   • Locked-rate drawdown: a covered line costs the PACKAGE's rate, not the
//     class's walk-in price — in both directions.
//   • Chronological exhaustion cutover, FIFO by earliest expiry, the expiry
//     boundary ON expires_on, coverage starting at confirmation, category
//     scope, and package-then-credit precedence.
//   • ⚠ RISK 4: package_live_balances()'s prediction equals the engine's
//     settled result — the derivation and the draw cannot drift silently.
//
// All feature tests fail on the pre-package engine (it never drew a cent),
// which is §7.25's discrimination requirement satisfied by construction; the
// tripwire is the one deliberate exception and is labelled above.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { generateInvoices } from "./core.ts";
import {
  newScenario,
  monthEnded,
  getInvoice,
  checkInvariants,
  type Scenario,
} from "./test-helpers.ts";

// ── Package fixtures (service client — bypasses RLS like the engine) ────────

async function addCategory(s: Scenario, name: string): Promise<string> {
  const { data, error } = await s.db
    .from("class_categories")
    .insert({ tenant_id: s.tenantId, name: `${name} ${s.tag}` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addCategory: ${error?.message}`);
  return data.id as string;
}

async function setClassCategory(
  s: Scenario,
  classId: string,
  categoryId: string | null
): Promise<void> {
  const { error } = await s.db
    .from("classes")
    .update({ category_id: categoryId })
    .eq("id", classId);
  if (error) throw new Error(`setClassCategory: ${error.message}`);
}

async function addProduct(
  s: Scenario,
  opts: { lessons: number; rate: number; months?: number; categoryId?: string | null }
): Promise<string> {
  const { data, error } = await s.db
    .from("package_products")
    .insert({
      tenant_id: s.tenantId,
      name: `${opts.lessons} lessons @ ${opts.rate} (${s.tag})`,
      category_id: opts.categoryId ?? null,
      lesson_count: opts.lessons,
      rate_per_lesson: opts.rate,
      validity_months: opts.months ?? 12,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addProduct: ${error?.message}`);
  return data.id as string;
}

/** Active package for the scenario's parent. confirmedAt is an ISO instant;
 *  coverage starts on its SGT date. */
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

async function pkgRemaining(s: Scenario, pkgId: string): Promise<number> {
  const { data } = await s.db
    .from("parent_packages")
    .select("value_remaining")
    .eq("id", pkgId)
    .single();
  return Number(data?.value_remaining);
}

// ── The tripwire: no package ⇒ the ad-hoc path, untouched ───────────────────

Deno.test("TRIPWIRE (⚠ RISK 1): a parent with NO package gets exactly the pre-package invoice", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-01") });
  try {
    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-09"); await s.mark(b, "present");
    await s.completeMonth("2027-01");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-01",
      now: s.now,
    });
    assertEquals(res.invoices_created, 1);
    assertEquals(res.created![0].package, 0);

    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assertEquals(inv!.gross, 60);
    assertEquals(inv!.package_applied, 0);
    assertEquals(inv!.credit_applied, 0);
    assertEquals(inv!.net, 60);
    assertEquals(inv!.status, "outstanding");

    // No ledger rows anywhere near this invoice.
    const { data: items } = await s.db
      .from("invoice_items").select("id").eq("invoice_id", inv!.id);
    const { data: apps } = await s.db
      .from("package_applications")
      .select("id")
      .in("invoice_item_id", (items ?? []).map((i) => i.id));
    assertEquals((apps ?? []).length, 0);

    const inv2 = await checkInvariants(s.db, s.parentId);
    assert(inv2.ok, inv2.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

// ── Locked-rate coverage ─────────────────────────────────────────────────────

Deno.test("a covered lesson costs the PACKAGE rate, not the class's walk-in price; fully covered ⇒ paid", async () => {
  // Class charges $50 walk-in; the package locked $40.
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01") });
  try {
    const productId = await addProduct(s, { lessons: 10, rate: 40 });
    const pkgId = await buyPackage(s, productId, "2026-12-01T04:00:00Z");

    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-09"); await s.mark(b, "present");
    await s.completeMonth("2027-01");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-01",
      now: s.now,
    });
    assertEquals(res.invoices_created, 1);
    assertEquals(res.created![0].package, 80);

    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assertEquals(inv!.gross, 80); // 2 × $40 locked — NOT 2 × $50
    assertEquals(inv!.package_applied, 80);
    assertEquals(inv!.net, 0);
    assertEquals(inv!.status, "paid");

    assertEquals(await pkgRemaining(s, pkgId), 320); // 400 − 80

    const { data: items } = await s.db
      .from("invoice_items").select("id").eq("invoice_id", inv!.id);
    const { data: apps } = await s.db
      .from("package_applications")
      .select("amount")
      .in("invoice_item_id", (items ?? []).map((i) => i.id))
      .is("reversed_at", null);
    assertEquals((apps ?? []).length, 2);

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("exhaustion cuts over CHRONOLOGICALLY: earliest lessons draw, the rest bill at class rate", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01") });
  try {
    const productId = await addProduct(s, { lessons: 1, rate: 40 });
    const pkgId = await buyPackage(s, productId, "2026-12-01T04:00:00Z");

    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-09"); await s.mark(b, "present");
    await s.completeMonth("2027-01");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2027-01", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assertEquals(inv!.gross, 90); // $40 covered + $50 ad-hoc
    assertEquals(inv!.package_applied, 40);
    assertEquals(inv!.net, 50);
    assertEquals(await pkgRemaining(s, pkgId), 0);

    // The EARLIER lesson took the package rate.
    const { data: items } = await s.db
      .from("invoice_items")
      .select("session_date, amount")
      .eq("invoice_id", inv!.id)
      .order("session_date");
    assertEquals(Number(items![0].amount), 40);
    assertEquals(Number(items![1].amount), 50);
  } finally {
    await s.teardown();
  }
});

Deno.test("two packages: the one expiring FIRST draws first, whatever the purchase order", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01") });
  try {
    // Bought first but expires LATER (24 months) — must NOT draw first.
    const late = await buyPackage(
      s, await addProduct(s, { lessons: 1, rate: 40, months: 24 }),
      "2026-12-01T04:00:00Z"
    );
    // Bought second but expires SOONER (12 months).
    const soon = await buyPackage(
      s, await addProduct(s, { lessons: 1, rate: 40, months: 12 }),
      "2026-12-02T04:00:00Z"
    );

    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    await s.completeMonth("2027-01");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2027-01", now: s.now,
    });

    assertEquals(await pkgRemaining(s, soon), 0);  // drew
    assertEquals(await pkgRemaining(s, late), 40); // untouched
  } finally {
    await s.teardown();
  }
});

Deno.test("expiry boundary: a lesson ON expires_on is covered; one after it bills ad-hoc despite remaining value", async () => {
  // Confirmed 2026-07-10 + 12 months ⇒ expires_on 2027-07-10, a Saturday.
  const s = await newScenario({ price: 50, billing: monthEnded("2027-07") });
  try {
    const productId = await addProduct(s, { lessons: 2, rate: 40, months: 12 });
    const pkgId = await buyPackage(s, productId, "2026-07-10T04:00:00Z");

    const a = await s.addSession("2027-07-10"); await s.mark(a, "present"); // ON expiry
    const b = await s.addSession("2027-07-17"); await s.mark(b, "present"); // after
    await s.completeMonth("2027-07");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2027-07", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-07");
    assertEquals(inv!.package_applied, 40); // only the on-expiry lesson
    assertEquals(inv!.gross, 90);
    assertEquals(inv!.net, 50);
    assertEquals(await pkgRemaining(s, pkgId), 40); // one lesson left, expired unspent
  } finally {
    await s.teardown();
  }
});

Deno.test("coverage starts at confirmation: a lesson BEFORE the purchase bills ad-hoc", async () => {
  // March 2027 Saturdays: 6, 13, 20, 27. Confirmed 15 Mar 04:00 SGT.
  const s = await newScenario({ price: 50, billing: monthEnded("2027-03") });
  try {
    const productId = await addProduct(s, { lessons: 10, rate: 40 });
    const pkgId = await buyPackage(s, productId, "2027-03-14T20:00:00Z"); // 15 Mar SGT

    const a = await s.addSession("2027-03-06"); await s.mark(a, "present"); // before purchase
    const b = await s.addSession("2027-03-20"); await s.mark(b, "present"); // after
    await s.completeMonth("2027-03");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2027-03", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-03");
    assertEquals(inv!.gross, 90);           // $50 ad-hoc + $40 covered
    assertEquals(inv!.package_applied, 40);
    assertEquals(await pkgRemaining(s, pkgId), 360);
  } finally {
    await s.teardown();
  }
});

Deno.test("category scope: only classes IN the category draw; others bill ad-hoc", async () => {
  const s = await newScenario({
    price: 30,
    secondClass: { price: 30 },
    billing: monthEnded("2027-01"),
  });
  try {
    const groupCat = await addCategory(s, "Group");
    await setClassCategory(s, s.classId, groupCat); // class 1 = Group
    // class 2 stays uncategorized — outside every scoped package.

    const productId = await addProduct(s, { lessons: 10, rate: 25, categoryId: groupCat });
    const pkgId = await buyPackage(s, productId, "2026-12-01T04:00:00Z");

    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-03", s.classId2);
    await s.mark(b, "present", s.studentId2);
    await s.completeMonth("2027-01");
    await s.completeMonth("2027-01", s.classId2);

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2027-01", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assertEquals(inv!.gross, 55);           // $25 covered + $30 ad-hoc
    assertEquals(inv!.package_applied, 25);
    assertEquals(inv!.net, 30);
    assertEquals(await pkgRemaining(s, pkgId), 225);
  } finally {
    await s.teardown();
  }
});

Deno.test("precedence: the package covers its lines, credit notes then cover the CASH remainder", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-06") });
  try {
    // Month 1 (May 2027): bill one $30 lesson, then correct it to absent —
    // the trigger issues a $30 credit note into the tenant balance.
    const m1 = await s.addSession("2027-05-01"); await s.mark(m1, "present");
    await s.completeMonth("2027-05");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2027-05", now: s.now,
    });
    await s.mark(m1, "absent"); // billable → non-billable on an invoiced lesson
    assertEquals(await s.tenantCreditBalance(), 30);

    // Month 2 (June 2027): a 1-lesson package plus two lessons.
    const productId = await addProduct(s, { lessons: 1, rate: 40 });
    await buyPackage(s, productId, "2027-06-01T04:00:00Z");
    const a = await s.addSession("2027-06-05"); await s.mark(a, "present");
    const b = await s.addSession("2027-06-12"); await s.mark(b, "present");
    await s.completeMonth("2027-06");

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2027-06", now: s.now,
    });

    const inv = await getInvoice(s.db, s.parentId, "2027-06");
    assertEquals(inv!.gross, 70);            // $40 covered + $30 ad-hoc
    assertEquals(inv!.package_applied, 40);  // package covers ITS line
    assertEquals(inv!.credit_applied, 30);   // credit covers the cash rest
    assertEquals(inv!.net, 0);
    assertEquals(inv!.status, "paid");
    assertEquals(await s.tenantCreditBalance(), 0);

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 4: the RPC's prediction equals the engine's settled result ───────

Deno.test("package_live_balances() predicts EXACTLY what the engine settles", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01") });
  try {
    const productId = await addProduct(s, { lessons: 10, rate: 40 });
    const pkgId = await buyPackage(s, productId, "2026-12-01T04:00:00Z");

    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-09"); await s.mark(b, "present");
    await s.completeMonth("2027-01");

    // BEFORE generation: stored balance untouched, live balance predicted.
    const { data: liveRows, error: rpcErr } = await s.db.rpc("package_live_balances");
    if (rpcErr) throw new Error(`rpc: ${rpcErr.message}`);
    const mine = (liveRows as Record<string, unknown>[]).find(
      (r) => r.parent_package_id === pkgId
    );
    assert(mine, "RPC returned no row for the package");
    assertEquals(Number(mine!.value_remaining), 400);
    assertEquals(Number(mine!.live_value_remaining), 320);
    assertEquals(Number(mine!.live_lessons_remaining), 8);

    await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2027-01", now: s.now,
    });

    // AFTER: the engine settled to the RPC's prediction — no drift.
    assertEquals(await pkgRemaining(s, pkgId), 320);

    // And the RPC's live balance now matches the stored one (nothing pending).
    const { data: liveAfter } = await s.db.rpc("package_live_balances");
    const after = (liveAfter as Record<string, unknown>[]).find(
      (r) => r.parent_package_id === pkgId
    );
    assertEquals(Number(after!.live_value_remaining), 320);
  } finally {
    await s.teardown();
  }
});
