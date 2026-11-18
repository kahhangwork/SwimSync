// clock: pinnable
//
// CARRIED-OVER PACKAGES — docs/plans/CARRIED_OVER_PACKAGES_PLAN.md (20261118000200), Step 5.
// Fixture: fixtures-carried-over-package.sql (prefix cop / ids c0a00000-).
//
// What it proves, end to end in both apps:
//   • Admin → Record a sale → "Existing package (bought before SwimSync)": Original start T−42, 6 of 10 left →
//     an active package, S$180 left, S$0 paid, coverage from TODAY, expiry = T−42 + 70 (D1/D2/D3);
//   • the held row shows the ORIGINAL start and "Brought in … · 6 left then";
//   • a lesson marked TODAY draws from it (6 → 5);
//   • Parent app → Billing → Packages: "5 lessons remaining", "S$150.00 of S$300.00" — an ordinary card (D4);
//   • Admin cancels it → Refund is offered (RISK 6), the ceiling is the value left, and a S$150 refund records.
//
// Setup:
//   cd SwimSyncAdmin && npm run dev            # :3000
//   cd SwimSyncApp && npx expo start --web     # :8081
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-carried-over-package.sql
//   node .claude/skills/run-ui-playwright/drivers/verify-carried-over-package.mjs

import os from "node:os";
import { launch, loginExpo, loginAdmin, tap, rowAction, ADMIN, todaySg, addDaysIso, sql } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const TENANT = "c0a00000-0000-0000-0000-000000000001";
const AVA = "c0a00000-0000-0000-0000-0000000005a0";
const CLASS = "c0a00000-0000-0000-0000-00000000c1a0";
const OWNER = "c0a00000-0000-0000-0000-0000000000a1";

const results = [];
function check(label, cond, detail = "") {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail && !cond ? ` — ${detail}` : ""}`);
}
const text = (page) => page.evaluate(() => document.body.innerText);

const today = todaySg();
const origStart = addDaysIso(today, -42);
const expectedEnd = addDaysIso(origStart, 70);
const pkgRow = () =>
  sql(`SELECT id || '|' || status || '|' || value_remaining || '|' || amount_payable || '|' || start_date || '|' ||
              expires_on || '|' || carried_over_start || '|' || carried_over_lessons
         FROM parent_packages WHERE tenant_id = '${TENANT}' AND carried_over_start IS NOT NULL`).split("|");

const { browser, page } = await launch({ mobile: true });

try {
  check("precondition: the family holds no package", sql(`SELECT count(*) FROM parent_packages WHERE tenant_id = '${TENANT}'`) === "0");

  // ── Admin: bring the package in ────────────────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAdmin(page, "cop-owner@swimsync.test");
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await tap(page.getByRole("button", { name: "Record a sale", exact: true }), "Record a sale");
  const modal = page.locator("div.fixed.inset-0");
  await tap(modal.getByTestId("sale-carried-toggle"), "Existing package toggle");
  await modal.locator("select").first().selectOption({ label: "COP Parent" });
  await modal.locator("select").nth(1).selectOption({ label: "COP Ten — S$300.00" });
  await page.waitForTimeout(1000);
  let m = await modal.innerText();
  check("the toggle swaps in Original start + Lessons remaining (of 10), and shows no price",
    /Original start date/.test(m) && /Lessons remaining \(of 10\)/.test(m) && !/Pays S\$/.test(m), m.slice(0, 600));
  await modal.getByLabel("Original start date").fill(origStart);
  await modal.getByLabel(/Lessons remaining/).fill("6");
  await tap(modal.getByRole("button", { name: "Bring in package", exact: true }), "Bring in package");
  await page.waitForTimeout(3000);

  let r = pkgRow();
  check("an active package: S$180 left, S$0 paid", r[1] === "active" && r[2] === "180.00" && r[3] === "0.00", r.join("|"));
  check("coverage starts TODAY; expiry = original start + 10 weeks",
    r[4] === today && r[5] === expectedEnd && r[6] === origStart && r[7] === "6", `${r.join("|")} vs ${today}/${expectedEnd}`);

  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const held = page.locator("tr", { hasText: "COP Parent" }).first();
  const ht = await held.innerText();
  check("the held row says it was brought in, with the lessons left then", /Brought in .*· 6 left then/.test(ht), ht);

  // ── A lesson marked TODAY draws from it ───────────────────────────────────────────────────────────────────
  sql(`INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time) VALUES ('${CLASS}', '${today}', '06:00', '06:45')`);
  sql(`INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
       SELECT id, '${AVA}', 'present', '${OWNER}' FROM lesson_sessions WHERE class_id = '${CLASS}' AND session_date = '${today}'`);
  r = pkgRow();
  check("today's lesson drew one lesson (S$180 → S$150)", r[2] === "150.00", r.join("|"));

  // ── Parent app: an ordinary package card ──────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await loginExpo(page, "cop-parent@swimsync.test");
  await page.waitForTimeout(2500);
  await tap(page.getByText("Billing", { exact: true }).last(), "Billing tab");
  await page.waitForTimeout(3000);
  await tap(page.getByText("Packages", { exact: true }), "Packages tab");
  await page.waitForTimeout(2500);
  const t = await text(page);
  check("parent card: 5 lessons remaining, S$150.00 of S$300.00",
    /5\s*\n?\s*lessons remaining/.test(t) && /S\$150\.00 of S\$300\.00/.test(t), t.slice(0, 700));
  check("parent card: no 'carried over' label (D4)", !/carried|brought in/i.test(t));
  await page.screenshot({ path: `${SHOT}/cop-parent.png`, fullPage: true });

  // ── Admin: cancel → Refund up to the value left ───────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAdmin(page, "cop-owner@swimsync.test");
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await tap(await rowAction(page.locator("tr", { hasText: "COP Parent" }).first(), "Cancel"), "Cancel (row)"); // in the "…" menu
  await tap(modal.getByRole("button", { name: "Cancel package", exact: true }), "Cancel package");
  await page.waitForTimeout(2500);
  const refundBtn = page.locator("tr", { hasText: "COP Parent" }).first().getByRole("button", { name: "Record refund", exact: true });
  check("a cancelled carried package offers Record refund (S$0 was paid here)", (await refundBtn.count()) === 1);
  await tap(refundBtn, "Record refund");
  m = await modal.innerText();
  check("the ceiling is the value left on the package", /Up to S\$150\.00 — the value left on the package\./.test(m), m.slice(0, 500));
  await modal.getByLabel("Amount refunded (S$)").fill("150");
  await tap(modal.getByRole("button", { name: "Record refund", exact: true }), "Record refund (confirm)");
  await page.waitForTimeout(2500);
  check("the S$150 refund recorded",
    sql(`SELECT count(*) || '|' || COALESCE(sum(amount), 0) FROM package_refunds WHERE tenant_id = '${TENANT}' AND reversed_at IS NULL`) === "1|150.00");
  await page.screenshot({ path: `${SHOT}/cop-admin.png`, fullPage: true });
} catch (e) {
  // §7.79 — a crash is a failed check, so it goes through the same tally.
  check(`the driver ran to completion — it crashed: ${e.message}`, false, String(e.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(results.length > 0 && passed === results.length ? 0 : 1);
}
