// clock: pinnable
// verify-invoice-overdue.mjs — due dates and Overdue, end to end
// (docs/plans/OVERDUE_INVOICES_PLAN.md Unit 5, migration 20261112000100).
//
// WHAT THIS PROVES:
//   • Admin Invoices: the Due column, and the tag from the DATABASE's verdict —
//     Overdue (c1, c4), Claimed beats Overdue (c2, D4), due-today is NOT overdue
//     (c3, the boundary at the UI layer).
//   • Days to pay saves through the REAL tenants PATCH (guard_tenant_columns maps
//     it to billing — ⚠ RISK 4), and survives a reload.
//   • Change due date: row menu → modal → change_invoice_due_date; the row
//     re-reads as Outstanding after the refetch, the DB moved, one audit row.
//   • A billing-VIEW admin is offered no Change due date.
//   • Dashboard: the Outstanding card counts overdue-and-not-claimed.
//   • Parent Billing list and the sessionless public payment page show the due
//     line; Claimed reads as Due there too.
//   • NOT proven here: the "Please pay by" email line (Deno: email.test.ts,
//     core.test.ts) or the WhatsApp wording (vitest: waMessage.test.ts).
//
// Setup (run-all-drivers.sh --only invoice-overdue does all of it):
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-invoice-overdue.sql
//   Admin dev server on :3000, Expo web on :8081. Teardown before a re-run.

import { ADMIN, EXPO, addDaysIso, launch, loginAdmin, loginExpo, rowAction, rowActionCount,
  sgLabel, sgMonthLabel, sql, tap, todaySg, visibleText } from "./lib.mjs";

const T = "da200000-0000-0000-0000-000000000001";
const ID = (n) => `da200000-0000-0000-0000-0000000000c${n}`;
const TOKEN = (n) => `da200000c0ffee00da200000c0ffee0${n}`;
const MONTH = { 1: "2026-01", 2: "2026-02", 3: "2026-03", 4: "2026-04" };
const dueOf = (n) => sql(`SELECT due_date FROM invoices WHERE id = '${ID(n)}'`);
const label = (iso) => sgLabel(iso, { day: "numeric", month: "short" });

const results = [];
const check = (label_, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label_}${detail ? ` — ${detail}` : ""}`);
};

const { browser, page } = await launch();
const rowOf = (p, n) => p.locator("tbody tr").filter({ hasText: sgMonthLabel(MONTH[n]) });
const tagIn = async (row, word) => (await row.getByText(word, { exact: true }).count()) > 0;

try {
  // ══ 0. The fixture's states, from the database itself ═════════════════════
  check("fixture: c3 is due today", dueOf(3) === todaySg(), `${dueOf(3)} vs ${todaySg()}`);

  // ══ 1. Admin (billing edit): Invoices ═════════════════════════════════════
  await loginAdmin(page, "overdue-driver-admin@swimsync.test");
  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  check("c1 reads Overdue", await tagIn(rowOf(page, 1), "Overdue"));
  check("c2 (claimed, past due) reads Claimed, not Overdue",
    (await tagIn(rowOf(page, 2), "Claimed")) && !(await tagIn(rowOf(page, 2), "Overdue")));
  check("c3 (due today) reads Outstanding, not Overdue",
    (await tagIn(rowOf(page, 3), "Outstanding")) && !(await tagIn(rowOf(page, 3), "Overdue")));
  check("c4 reads Overdue", await tagIn(rowOf(page, 4), "Overdue"));
  check("the Due column shows c1's stored date",
    (await rowOf(page, 1).getByText(label(dueOf(1)), { exact: true }).count()) === 1, label(dueOf(1)));

  // ── Days to pay, through the real PATCH ────────────────────────────────────
  const days = page.locator("#payment-days");
  check("Days to pay shows the default 14", (await days.inputValue()) === "14", await days.inputValue());
  await days.fill("21");
  await days.blur();
  await page.waitForTimeout(1500);
  check("Days to pay: no refusal shown", (await page.locator("#payment-days-message").count()) === 0);
  check("Days to pay: stored 21 (guard_tenant_columns let billing edit through)",
    sql(`SELECT invoice_payment_days FROM tenants WHERE id = '${T}'`) === "21");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  check("Days to pay: 21 survives a reload", (await page.locator("#payment-days").inputValue()) === "21");
  check("Days to pay: existing due dates did not move (D2)", dueOf(3) === todaySg());

  // ── Change due date on c1 ──────────────────────────────────────────────────
  const newDue = addDaysIso(todaySg(), 30);
  const oldDue = dueOf(1);
  await (await rowAction(rowOf(page, 1), "Change due date")).click();
  await page.waitForTimeout(500);
  check("the Change due date modal opens", await page.getByText("New due date").isVisible());
  await page.locator("#new-due-date").fill(newDue);
  await page.locator("#due-date-reason").fill("driver: family asked");
  await page.getByRole("button", { name: "Save due date" }).click();
  await page.waitForTimeout(2500);
  check("the DB due date moved", dueOf(1) === newDue, `${dueOf(1)} vs ${newDue}`);
  check("one audit row, old → new, with the reason",
    sql(`SELECT old_due_date || '>' || new_due_date || '|' || reason FROM invoice_due_date_changes
          WHERE invoice_id = '${ID(1)}'`) === `${oldDue}>${newDue}|driver: family asked`);
  check("after the refetch c1 reads Outstanding",
    (await tagIn(rowOf(page, 1), "Outstanding")) && !(await tagIn(rowOf(page, 1), "Overdue")));
  check("…and its Due cell shows the new date",
    (await rowOf(page, 1).getByText(label(newDue), { exact: true }).count()) === 1, label(newDue));

  // ── Dashboard: overdue and not claimed = c4 only now ───────────────────────
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  check("dashboard: the Outstanding card says 1 overdue",
    await page.getByText("Unpaid · 1 overdue", { exact: true }).isVisible());

  // ══ 2. Admin (billing VIEW): no Change due date ═══════════════════════════
  const viewer = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await loginAdmin(viewer, "overdue-driver-viewer@swimsync.test");
  await viewer.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await viewer.waitForTimeout(2500);
  check("viewer: the invoices load (c4 Overdue)", await tagIn(rowOf(viewer, 4), "Overdue"));
  check("viewer: no Change due date on an outstanding row",
    (await rowActionCount(rowOf(viewer, 4), "Change due date")) === 0);
  await viewer.close();

  // ══ 3. Parent: Billing list ═══════════════════════════════════════════════
  const parent = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true });
  await loginExpo(parent, "overdue-driver-parent@swimsync.test");
  await tap(parent.getByText("Billing").last(), "billing tab");
  await parent.waitForTimeout(7000);
  check("parent: the Billing tab is actually open", /\/billing/.test(parent.url()), parent.url());
  const body = await visibleText(parent);
  check("parent: c4 shows 'Overdue — was due …'", body.includes(`Overdue — was due ${label(dueOf(4))}`));
  check("parent: c3 shows 'Due <today>'", body.includes(`Due ${label(todaySg())}`));
  check("parent: c1 shows its moved date", body.includes(`Due ${label(newDue)}`));
  check("parent: exactly one invoice reads overdue (c2 is claimed, c1 moved)",
    body.split("Overdue — was due").length - 1 === 1);
  await parent.close();

  // ══ 4. The sessionless public payment page ════════════════════════════════
  // One fresh sessionless page per token: a second goto on the same page can
  // keep the first invoice's render on screen (§7.10).
  const publicText = async (n) => {
    const pub = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true });
    await pub.goto(`${EXPO}/invoice/${TOKEN(n)}`, { waitUntil: "domcontentloaded" });
    await pub.waitForTimeout(8000);
    const t = await visibleText(pub);
    await pub.close();
    return t;
  };
  let text = await publicText(4);
  check("public: an overdue invoice says so", text.includes(`Overdue — was due ${label(dueOf(4))}`));
  text = await publicText(2);
  check("public: a claimed invoice reads Due, never Overdue",
    // "was due", not "Overdue": the fixture business is named "Overdue Driver Swim".
    text.includes(`Due ${label(dueOf(2))}`) && !text.includes("was due"),
    text.replace(/\s+/g, " ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e?.message ?? e);
  results.push(false);
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
