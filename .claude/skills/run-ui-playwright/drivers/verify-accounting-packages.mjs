// Drive package revenue on the Accounting page (PACKAGE_REVENUE_REFUNDS_PLAN.md U1;
// migration 20260928000100).
//
// What only THIS driver can prove (pgTAP owns the arithmetic): the owner's page
// shows a package paid in a closed month as its OWN breakdown line, at what the
// family PAID (after the discount), and Revenue adds it once.
//
// Setup/Prereqs:
//   supabase start; admin panel on :3000 (or ADMIN_URL)
//   fixture: fixtures-accounting-packages.sql — AcctPkg Swim, last month SEALED
//   for that business only (§7.301), a package total 300 / payable 270, an
//   invoice net 140, a S$50 refund paid out that month (U2). Read-only driver:
//   re-runnable without a teardown.
//
// Persona (password123):
//   acctpkg-owner@swimsync.test   owner of AcctPkg Swim
//
// PROVEN RED (2026-09-27): with accounting_summary summing pp.total_value, check 2
// fails (S$300.00) and so does check 3 (then S$440.00). With refunds not
// subtracted from v_revenue, check 3 fails (S$410.00) (U2).

import os from "node:os";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/accounting-packages-${n}`;

const results = [];
function check(label, pass, detail = "") {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : ` — ${detail}`}`);
}

// The value cell that follows a breakdown label (<dt>label</dt><dd>value</dd>).
async function lineValue(page, label) {
  const dt = page.locator("dt", { hasText: label }).first();
  if ((await dt.count()) === 0) return null;
  return (await dt.locator("xpath=following-sibling::dd[1]").innerText()).trim();
}

const { browser, page } = await launch();

await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => window.localStorage.clear());
await loginAdmin(page, "acctpkg-owner@swimsync.test");
await page.goto(`${ADMIN}/accounting`, { waitUntil: "networkidle" });
await page.getByTestId("tile-revenue").waitFor({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1000);

// ── 1. The closed month is offered and loads ─────────────────────────────────
const revenueTile = page.getByTestId("tile-revenue");
check("the owner's Accounting page shows figures for the closed month",
  (await revenueTile.count()) === 1,
  (await page.evaluate(() => document.body.innerText)).slice(0, 300));

// ── 2. The package is its own line, at the amount PAID ───────────────────────
const sold = await lineValue(page, "+ Packages sold (paid this month)");
check("'+ Packages sold (paid this month)' shows S$270.00 — what was paid, not the S$300 face value",
  sold === "S$270.00", `got ${sold}`);

// ── 3. Revenue adds it once and takes the refund off: 140 + 270 − 50 ─────────
const revenue = await lineValue(page, "= Revenue");
check("= Revenue is S$360.00 (invoiced S$140.00 + packages S$270.00 − refunds S$50.00)",
  revenue === "S$360.00", `got ${revenue}`);
const refunds = await lineValue(page, "− Package refunds (paid out this month)");
check("'− Package refunds (paid out this month)' shows S$50.00", refunds === "S$50.00", `got ${refunds}`);
const applied = await lineValue(page, "− Packages applied");
check("'− Packages applied' is still its own line (S$60.00), not merged with the sale",
  applied === "S$60.00", `got ${applied}`);

// ── 4. The two bases are named on the page ──────────────────────────────────
const note = await page.getByTestId("revenue-basis-note").innerText().catch(() => "");
check("the basis note says packages count the month they were paid",
  note.includes("packages count the month they were paid"), note);
await page.screenshot({ path: shot("01-breakdown.png"), fullPage: true });

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
