// Prepaid lesson packages — what the INVOICE looks like for a package family
// (PACKAGES_DESIGN.md §3). A package pays for a lesson at MARKING (the
// attendance trigger → package_candidates_for); the engine bills only what was
// not drawn, at the class price. The pay-at-the-run matcher these tests were
// first written against was removed (BACKLOG Wave 9 item 9); each test keeps its
// rule and now asserts it end to end — the draw, the balance, and the invoice.
//
// What is pinned here:
//   • THE TRIPWIRE: a parent with no package produces exactly the invoice
//     they always did (⚠ RISK 1 — package logic must not leak into the
//     ad-hoc path). This is a regression guard by design.
//   • Locked rate: a drawn lesson costs the PACKAGE's rate, and never reaches
//     the invoice at the class's walk-in price.
//   • Chronological exhaustion cutover, FIFO by earliest expiry, the expiry
//     boundary ON expires_on, coverage from the start date (confirmation or an
//     explicit later start), category scope, holiday-extension tail, and
//     credit notes covering the cash remainder.
//   • package_live_balances() reports the stored balance — the draw already
//     moved it, so there is nothing left to predict.
//
// Dates are 2027 on purpose: the D6 guard reads the REAL clock, and lessons
// after today are never "unmarked", so the guard stays out of these tests.

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
  opts: {
    lessons: number;
    rate: number;
    months?: number;
    weeks?: number;
    categoryId?: string | null;
  }
): Promise<string> {
  // Supply weeks OR months; the derive trigger fills the other column.
  const validity =
    opts.weeks !== undefined
      ? { validity_weeks: opts.weeks }
      : { validity_months: opts.months ?? 12 };
  const { data, error } = await s.db
    .from("package_products")
    .insert({
      tenant_id: s.tenantId,
      name: `${opts.lessons} lessons @ ${opts.rate} (${s.tag})`,
      category_id: opts.categoryId ?? null,
      lesson_count: opts.lessons,
      rate_per_lesson: opts.rate,
      ...validity,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addProduct: ${error?.message}`);
  return data.id as string;
}

/** Active package for the scenario's parent. confirmedAt is an ISO instant;
 *  coverage starts on startDate if given, else the SGT date of confirmation.
 *  The end date is startDate + validity_weeks*7 (package_effective_end). */
async function buyPackage(
  s: Scenario,
  productId: string,
  confirmedAt: string,
  startDate?: string
): Promise<string> {
  const { data, error } = await s.db
    .from("parent_packages")
    .insert({
      tenant_id: s.tenantId,
      parent_id: s.parentId,
      product_id: productId,
      status: "active",
      confirmed_at: confirmedAt,
      ...(startDate ? { start_date: startDate } : {}),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`buyPackage: ${error?.message}`);
  return data.id as string;
}

async function liveDraws(s: Scenario, pkgId: string): Promise<string[]> {
  const { data } = await s.db
    .from("package_applications")
    .select("lesson_session_id, amount")
    .eq("parent_package_id", pkgId)
    .is("reversed_at", null);
  return (data ?? []).map((r) => `${r.lesson_session_id}:${Number(r.amount)}`).sort();
}

async function invoiceLines(s: Scenario, invoiceId: string): Promise<string[]> {
  const { data } = await s.db
    .from("invoice_items")
    .select("session_date, amount")
    .eq("invoice_id", invoiceId)
    .order("session_date");
  return (data ?? []).map((r) => `${r.session_date}:${Number(r.amount)}`);
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

const run = (s: Scenario, month: string) =>
  generateInvoices(s.db, {
    tenant_id: s.tenantId, mode: "manual", force: true, billing_month: month, now: s.now,
  });

Deno.test("a drawn lesson costs the PACKAGE rate, not the class's walk-in price; fully drawn ⇒ no invoice", async () => {
  // Class charges $50 walk-in; the package locked $40.
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01") });
  try {
    const productId = await addProduct(s, { lessons: 10, rate: 40 });
    const pkgId = await buyPackage(s, productId, "2026-12-01T04:00:00Z");

    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-09"); await s.mark(b, "present");
    assertEquals(await liveDraws(s, pkgId), [`${a}:40`, `${b}:40`].sort(), "2 × $40 locked — NOT 2 × $50");
    assertEquals(await pkgRemaining(s, pkgId), 320); // 400 − 80
    await s.completeMonth("2027-01");

    const res = await run(s, "2027-01");
    assertEquals(res.invoices_created, 0);
    assertEquals(await getInvoice(s.db, s.parentId, "2027-01"), null, "nothing left to bill");
    assertEquals(await pkgRemaining(s, pkgId), 320, "the engine never draws again");

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
    await run(s, "2027-01");

    // The EARLIER lesson drew; the later one is the invoice.
    assertEquals(await liveDraws(s, pkgId), [`${a}:40`]);
    assertEquals(await pkgRemaining(s, pkgId), 0);
    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assertEquals(await invoiceLines(s, inv!.id), ["2027-01-09:50"]);
    assertEquals(inv!.package_applied, 0);
    assertEquals(inv!.net, 50);
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

    assertEquals(await pkgRemaining(s, soon), 0);  // drew
    assertEquals(await pkgRemaining(s, late), 40); // untouched
  } finally {
    await s.teardown();
  }
});

Deno.test("expiry boundary: a lesson ON expires_on draws; one after it bills ad-hoc despite remaining value", async () => {
  // Validity is WEEKS now: 12 months ⇒ 52 weeks = 364 days. Start 2026-07-11
  // (a Saturday) ⇒ expires_on = start + 364 = 2027-07-10, the same Saturday
  // the sessions fall on. The explicit start makes the boundary exact instead
  // of relying on month arithmetic.
  const s = await newScenario({ price: 50, billing: monthEnded("2027-07") });
  try {
    const productId = await addProduct(s, { lessons: 2, rate: 40, months: 12 });
    const pkgId = await buyPackage(s, productId, "2026-07-10T04:00:00Z", "2026-07-11");

    const a = await s.addSession("2027-07-10"); await s.mark(a, "present"); // ON expiry
    const b = await s.addSession("2027-07-17"); await s.mark(b, "present"); // after
    await s.completeMonth("2027-07");
    await run(s, "2027-07");

    assertEquals(await liveDraws(s, pkgId), [`${a}:40`], "only the on-expiry lesson drew");
    assertEquals(await pkgRemaining(s, pkgId), 40); // one lesson left, expired unspent
    const inv = await getInvoice(s.db, s.parentId, "2027-07");
    assertEquals(await invoiceLines(s, inv!.id), ["2027-07-17:50"]);
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
    await run(s, "2027-03");

    assertEquals(await liveDraws(s, pkgId), [`${b}:40`]);
    assertEquals(await pkgRemaining(s, pkgId), 360);
    const inv = await getInvoice(s.db, s.parentId, "2027-03");
    assertEquals(await invoiceLines(s, inv!.id), ["2027-03-06:50"]);
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
    // Class 2 keeps the scenario's OTHER category, so it is outside this
    // package's scope. It used to be uncategorized; categories are mandatory
    // now (20260725000400) and "outside the scope" is a different category.

    const productId = await addProduct(s, { lessons: 10, rate: 25, categoryId: groupCat });
    const pkgId = await buyPackage(s, productId, "2026-12-01T04:00:00Z");

    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-03", s.classId2);
    await s.mark(b, "present", s.studentId2);
    await s.completeMonth("2027-01");
    await s.completeMonth("2027-01", s.classId2);
    await run(s, "2027-01");

    assertEquals(await liveDraws(s, pkgId), [`${a}:25`]);
    assertEquals(await pkgRemaining(s, pkgId), 225);
    const inv = await getInvoice(s.db, s.parentId, "2027-01");
    assertEquals(await invoiceLines(s, inv!.id), ["2027-01-03:30"]);
  } finally {
    await s.teardown();
  }
});

Deno.test("precedence: the package pays its lessons at marking; credit notes cover the CASH remainder", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-06") });
  try {
    // Month 1 (May 2027): bill one $30 lesson, then correct it to absent —
    // the trigger issues a $30 credit note into the tenant balance.
    const m1 = await s.addSession("2027-05-01"); await s.mark(m1, "present");
    await s.completeMonth("2027-05");
    await run(s, "2027-05");
    await s.mark(m1, "absent"); // billable → non-billable on an invoiced lesson
    assertEquals(await s.tenantCreditBalance(), 30);

    // Month 2 (June 2027): a 1-lesson package plus two lessons.
    const productId = await addProduct(s, { lessons: 1, rate: 40 });
    const pkgId = await buyPackage(s, productId, "2027-06-01T04:00:00Z");
    const a = await s.addSession("2027-06-05"); await s.mark(a, "present");
    const b = await s.addSession("2027-06-12"); await s.mark(b, "present");
    await s.completeMonth("2027-06");
    await run(s, "2027-06");

    assertEquals(await liveDraws(s, pkgId), [`${a}:40`], "the package pays ITS lesson");
    const inv = await getInvoice(s.db, s.parentId, "2027-06");
    assertEquals(inv!.gross, 30);           // only the $30 ad-hoc lesson
    assertEquals(inv!.package_applied, 0);
    assertEquals(inv!.credit_applied, 30);  // credit covers the cash rest
    assertEquals(inv!.net, 0);
    assertEquals(inv!.status, "paid");
    assertEquals(await s.tenantCreditBalance(), 0);

    const chk = await checkInvariants(s.db, s.parentId);
    assert(chk.ok, chk.problems.join("; "));
  } finally {
    await s.teardown();
  }
});

Deno.test("package_live_balances() reports the STORED balance — the draw already moved it", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01") });
  try {
    const productId = await addProduct(s, { lessons: 10, rate: 40 });
    const pkgId = await buyPackage(s, productId, "2026-12-01T04:00:00Z");

    const a = await s.addSession("2027-01-02"); await s.mark(a, "present");
    const b = await s.addSession("2027-01-09"); await s.mark(b, "present");

    const { data: liveRows, error: rpcErr } = await s.db.rpc("package_live_balances");
    if (rpcErr) throw new Error(`rpc: ${rpcErr.message}`);
    const mine = (liveRows as Record<string, unknown>[]).find(
      (r) => r.parent_package_id === pkgId
    );
    assert(mine, "RPC returned no row for the package");
    assertEquals(Number(mine!.value_remaining), 320);
    assertEquals(Number(mine!.live_value_remaining), 320);
    assertEquals(Number(mine!.live_lessons_remaining), 8);
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 2: the re-anchor to start_date (not SGT-of-confirmed_at) ──────────

Deno.test("start_date AFTER confirmation: a lesson between confirm and start is NOT funded", async () => {
  // Confirmed 2027-03-01, but the admin dated the package to start 2027-03-15.
  // The 2027-03-13 Saturday lesson falls in that gap → ad-hoc; 2027-03-20 is
  // inside the window → funded. Before the re-anchor the window opened at the
  // SGT confirmation date and the gap lesson would have been (wrongly) covered.
  const s = await newScenario({ price: 50, billing: monthEnded("2027-03") });
  try {
    const productId = await addProduct(s, { lessons: 10, rate: 40 });
    const pkgId = await buyPackage(s, productId, "2027-03-01T04:00:00Z", "2027-03-15");

    const gap = await s.addSession("2027-03-13"); await s.mark(gap, "present"); // before start
    const inWin = await s.addSession("2027-03-20"); await s.mark(inWin, "present"); // inside
    await s.completeMonth("2027-03");
    await run(s, "2027-03");

    assertEquals(await liveDraws(s, pkgId), [`${inWin}:40`]);
    assertEquals(await pkgRemaining(s, pkgId), 360);
    const inv = await getInvoice(s.db, s.parentId, "2027-03");
    assertEquals(await invoiceLines(s, inv!.id), ["2027-03-13:50"]);
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 4: a lesson in the extension TAIL is funded because of the holiday ─

Deno.test("a holiday extension funds a lesson in the tail that would otherwise bill ad-hoc", async () => {
  // Start 2027-01-02 (Sat), 2 weeks ⇒ nominal end 2027-01-16 (Sat). A holiday
  // on the class's Saturday inside the window pushes the end to 2027-01-23, so
  // the 2027-01-23 lesson — which is AFTER the nominal end — is now funded.
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01") });
  try {
    const productId = await addProduct(s, { lessons: 10, rate: 30, weeks: 2 });
    const pkgId = await buyPackage(s, productId, "2027-01-01T04:00:00Z", "2027-01-02");

    // Mark the in-window Saturday 2027-01-09 as a 'holiday' — that voids the
    // lesson AND extends the covering package by the tenant's holiday_extension_days
    // (default 7 = one week), pushing the end from 2027-01-16 to 2027-01-23.
    const hol = await s.addSession("2027-01-09"); await s.mark(hol, "holiday");
    const { data: extd } = await s.db.from("parent_packages")
      .select("holiday_extension_days").eq("id", pkgId).single();
    assertEquals(extd!.holiday_extension_days, 7, "the holiday extended the package by 7 days");

    // The tail lesson (2027-01-23 > nominal end 2027-01-16, ≤ extended 2027-01-23).
    const tail = await s.addSession("2027-01-23"); await s.mark(tail, "present");
    assertEquals(await liveDraws(s, pkgId), [`${tail}:30`], "the tail lesson was funded by the extension");
    assertEquals(await pkgRemaining(s, pkgId), 270);

    await s.completeMonth("2027-01");
    await run(s, "2027-01");
    assertEquals(await getInvoice(s.db, s.parentId, "2027-01"), null, "nothing left to bill");
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 4: a holiday extension cannot touch an already-SEALED month ───────

Deno.test("extending a package after a month is sealed changes no balance, and a re-run bills nothing", async () => {
  const s = await newScenario({ price: 50, billing: monthEnded("2027-01") });
  try {
    // The scenario's class is Saturdays; the student is enrolled. A package
    // whose window comfortably covers January.
    const productId = await addProduct(s, { lessons: 10, rate: 30 });
    const pkgId = await buyPackage(s, productId, "2027-01-01T04:00:00Z", "2027-01-01");

    const jan = await s.addSession("2027-01-09"); await s.mark(jan, "present");
    await s.completeMonth("2027-01");
    const res = await run(s, "2027-01");
    assertEquals(res.sealed, true);
    assertEquals(await pkgRemaining(s, pkgId), 270); // the January lesson drew

    // Now void a DIFFERENT in-window Saturday (2027-01-16, already a
    // cancelled_rain session from completeMonth) as a 'holiday'. That extends the
    // package's expiry — proving the event fired — without touching the sealed
    // month: cancelled_rain→holiday is non-billable→non-billable, so no credit
    // note, and holiday draws nothing.
    const { data: sat16 } = await s.db.from("lesson_sessions")
      .select("id").eq("class_id", s.classId).eq("session_date", "2027-01-16").single();
    await s.mark(sat16!.id, "holiday");
    const { data: pkg } = await s.db
      .from("parent_packages")
      .select("holiday_extension_days, value_remaining")
      .eq("id", pkgId)
      .single();
    assertEquals(pkg!.holiday_extension_days, 7, "extended by 7 days");
    assertEquals(Number(pkg!.value_remaining), 270, "balance unchanged by the extension");

    const res2 = await run(s, "2027-01");
    assertEquals(res2.invoices_created ?? 0, 0);
    assertEquals(await getInvoice(s.db, s.parentId, "2027-01"), null, "still nothing billed");
    assertEquals(await liveDraws(s, pkgId), [`${jan}:30`], "no second draw");
  } finally {
    await s.teardown();
  }
});
