// The admin panel is scoped by AUDIENCE: pages that show one business refuse an
// account that has none.
//
// WHY THIS EXISTS
//   A platform admin's RLS reach is every row of every table across every
//   tenant, so the business pages never errored for them — they rendered
//   several businesses' data as though it were one (the dashboard's "Total
//   Students … Across all coaches" was really across all BUSINESSES).
//
// THE TWO THINGS THIS MUST CATCH
//   1. A refusal rendered ON TOP of a still-mounted page. The rows would still
//      be in the DOM and a message-only assertion would pass (§7.10). So every
//      refusal check here also asserts the ABSENCE of data.
//   2. Locking out the real coach. A private coach is a tenant_admin who also
//      teaches — gating on the role enum is what shipped "Unrecognised role" to
//      production (§7.19). The tenant-admin half of this driver asserts every
//      page still renders its CONTENT, not merely that no refusal appeared.
//
// SETUP
//   supabase start && (cd SwimSyncAdmin && npm run dev)
//   node .claude/skills/run-ui-playwright/drivers/verify-platform-admin-scope.mjs
//   ADMIN_URL=http://localhost:3001 ... if 3000 is taken.

import os from "node:os";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const TENANT_PAGES = [
  "/dashboard", "/unassigned", "/classes", "/students", "/levels",
  "/parents", "/attendance", "/invoices", "/credit-notes", "/coaches", "/wages",
];

const REFUSAL = /This page shows a single business/;

async function go(page, path) {
  await page.goto(`${ADMIN}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  return {
    text: await page.evaluate(() => document.body.innerText),
    url: page.url(),
    // Data rows, excluding the sidebar. A refused page must have none.
    rows: await page.evaluate(
      () => document.querySelectorAll("main table tbody tr").length
    ),
    navLinks: await page.evaluate(() =>
      Array.from(document.querySelectorAll("aside a")).map((a) =>
        a.getAttribute("href")
      )
    ),
  };
}

const { browser, page } = await launch();
try {
  // ── PLATFORM ADMIN — no business ────────────────────────────────────────
  await loginAdmin(page, "superadmin@swimsync.test", "password123");
  await page.waitForTimeout(1500);

  check("platform admin LANDS on /platform after login, not /dashboard",
    page.url().includes("/platform"), page.url());

  const nav = await go(page, "/platform");
  check("sidebar shows ONLY Platform",
    nav.navLinks.length === 1 && nav.navLinks[0] === "/platform",
    JSON.stringify(nav.navLinks));

  // /dashboard redirects; everything else refuses in place.
  const dash = await go(page, "/dashboard");
  check("/dashboard REDIRECTS to /platform", dash.url.includes("/platform"), dash.url);

  // No loop: the URL must be stable once landed.
  const u1 = page.url();
  await page.waitForTimeout(2500);
  check("no redirect loop — URL is stable", page.url() === u1, `${u1} -> ${page.url()}`);

  for (const path of TENANT_PAGES.filter((p) => p !== "/dashboard")) {
    const r = await go(page, path);
    const refused = REFUSAL.test(r.text);
    // BOTH halves. A card above a mounted table would satisfy the first alone.
    check(`${path} refuses AND renders no data`, refused && r.rows === 0,
      `refused=${refused} rows=${r.rows}`);
  }

  // Spot-check that no real record leaked onto a refused page.
  const students = await go(page, "/students");
  check("/students shows no student name", !/Kid |Ethan|Tan\b/.test(students.text));

  await page.screenshot({ path: `${SHOT}/scope-platform.png`, fullPage: true });

  // ── TENANT ADMIN — the private coach, the shape production has ──────────
  await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, "coach@swimsync.test", "password123");
  await page.waitForTimeout(1500);

  check("tenant admin LANDS on /dashboard", page.url().includes("/dashboard"), page.url());

  const tnav = await go(page, "/dashboard");
  check("sidebar shows the 11 business pages", tnav.navLinks.length === 11,
    `${tnav.navLinks.length}: ${JSON.stringify(tnav.navLinks)}`);
  check("sidebar does NOT show Platform", !tnav.navLinks.includes("/platform"));

  // The regression that matters most: every page must still WORK for them.
  // Asserting "no refusal" is not enough — a blank page would pass that.
  const CONTENT = {
    "/dashboard":    /Total Students/,
    "/unassigned":   /Unassigned/,
    "/classes":      /Classes/,
    "/students":     /Students/,
    "/levels":       /Level/,
    "/parents":      /Parent/,
    "/attendance":   /Attendance/,
    "/invoices":     /Billing month/,
    "/credit-notes": /Credit Note/,
    "/coaches":      /Coach/,
    "/wages":        /Wage|Payout|Pay/,
  };
  for (const path of TENANT_PAGES) {
    const r = await go(page, path);
    const noRefusal = !REFUSAL.test(r.text);
    const hasContent = CONTENT[path].test(r.text);
    check(`${path} still works for the tenant admin`, noRefusal && hasContent,
      `refusal=${!noRefusal} content=${hasContent}`);
  }

  const plat = await go(page, "/platform");
  check("/platform refuses a tenant admin (the inverse guard still works)",
    /platform admin/i.test(plat.text));

  await page.screenshot({ path: `${SHOT}/scope-tenant.png`, fullPage: true });
  console.log(`\nscreenshots in ${SHOT}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
process.exit(failed ? 1 : 0);
