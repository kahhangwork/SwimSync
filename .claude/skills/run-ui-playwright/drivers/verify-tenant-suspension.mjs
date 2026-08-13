// Drive tenant suspension end to end (Wave 5 chunk 3, 20260813000300).
//
// What only THIS driver can prove (pgTAP owns the RLS/RPC layer): the BULK
// BAN/UNBAN half — the widest auth-layer change in the product — in a real
// browser: staff login dies on suspend and returns on unsuspend, the
// two-tenant parent keeps their OTHER business, and ⚠ RISK 3: a coach
// individually disabled BEFORE the suspend stays dead AFTER the unsuspend.
//
// ⚠ RISK 9 PROHIBITION: the finally-block below unsuspends the fixture
// tenant even when a check throws — a suspended tenant left on the shared
// local DB breaks every sibling driver that logs in as its staff. (The
// fixture tenant is the driver's own; the seed tenant is never suspended.)
//
// Setup/Prereqs:
//   supabase start; admin panel on :3000 (or ADMIN_URL); Expo web on :8081
//   (or EXPO_URL). fixture: fixtures-tenant-suspension.sql — the driver
//   consumes state (bans/unbans, audit rows), so a re-run needs
//   fixtures-tenant-suspension-teardown.sql first.
//
// Personas (all password123):
//   superadmin@swimsync.test   seed PLATFORM admin — the actor
//   ts-admin@swimsync.test     fixture tenant's owner-admin (ban subject)
//   ts-coach@swimsync.test     pre-disabled pure coach (⚠ RISK 3 subject)
//   ts-parent@swimsync.test    two-tenant parent (never banned)

import os from "node:os";
import { execSync } from "node:child_process";
import { launch, loginAdmin, loginExpo, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/tenant-suspension-${n}`;

const results = [];
function check(label, pass, detail = "") {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : ` — ${detail}`}`);
}

/** ⚠ RISK 9: SQL unsuspend that does not depend on any UI still working. */
function sqlUnsuspend() {
  execSync(
    `docker exec supabase_db_SwimSync psql -U postgres -d postgres -c ` +
    `"UPDATE tenants SET suspended_at = NULL WHERE id = 'e6aa0000-0000-0000-0000-000000000001';"`,
    { stdio: "pipe" }
  );
}

const { browser, page } = await launch();

/** Admin-panel login attempt; true if it STAYED on /login (banned). */
async function adminLoginDies(email) {
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, email);
  return new URL(page.url()).pathname.includes("/login");
}

/** One Expo login attempt; true if it STAYED on /login (banned/dead). A
 *  form-never-appeared run returns null — "cannot say", not a verdict. */
async function appLoginDies(email) {
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000); // Metro hydrate
  try {
    await page.getByPlaceholder("you@email.com").fill(email, { timeout: 10000 });
    await page.locator('input[type="password"]').fill("password123", { timeout: 5000 });
  } catch {
    return null;
  }
  await page.getByText("Sign In").last().click();
  await page.waitForTimeout(6000);
  return new URL(page.url()).pathname.endsWith("/login");
}

const row = (text) => page.locator("tr", { hasText: text });

try {
  // ── 1. Positive control: the parent sees BOTH businesses' children ────────
  const parentDied = await appLoginDies("ts-parent@swimsync.test");
  check("control: the parent logs in before the suspend", parentDied === false);
  await page.waitForTimeout(2500);
  let body = await page.evaluate(() => document.body.innerText);
  check("control: the parent sees children of BOTH businesses",
    body.includes("SuspendCov Gone Kid") && body.includes("SuspendCov Keep Kid"),
    body.slice(0, 400));
  await page.screenshot({ path: shot("01-parent-before.png"), fullPage: true });

  // ── 2. The Platform page, and the confirm dialog's copy ───────────────────
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, "superadmin@swimsync.test");
  await page.goto(`${ADMIN}/platform`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  check("the fixture business is listed with a Suspend action",
    (await row("SuspendCov School").innerText()).includes("Suspend"));

  await row("SuspendCov School").getByText("Suspend", { exact: true }).click();
  await page.waitForTimeout(800);
  body = await page.evaluate(() => document.body.innerText);
  check("the dialog carries the accepted-consequence copy (dark app, links keep working)",
    body.includes("goes dark") && body.includes("Already-sent invoice links keep working"),
    body.slice(0, 600));
  await page.screenshot({ path: shot("02-dialog.png"), fullPage: true });

  // ── 3. Suspend ────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Suspend this business", exact: true }).click();
  await page.waitForTimeout(4000);
  body = await page.evaluate(() => document.body.innerText);
  check("the row now shows the suspended badge and an Unsuspend action",
    (await row("SuspendCov School").innerText()).includes("suspended") &&
    (await row("SuspendCov School").innerText()).includes("Unsuspend"));
  await page.screenshot({ path: shot("03-suspended.png"), fullPage: true });

  // ── 4. The ban half: staff login dies ─────────────────────────────────────
  check("the suspended tenant's ADMIN login DIES (the bulk-ban half)",
    (await adminLoginDies("ts-admin@swimsync.test")) === true);
  await page.screenshot({ path: shot("04-admin-dead.png"), fullPage: true });

  // ── 5. The parent keeps their OTHER business ──────────────────────────────
  const parentDiedNow = await appLoginDies("ts-parent@swimsync.test");
  check("the parent still logs in (parents are NEVER banned)", parentDiedNow === false);
  await page.waitForTimeout(2500);
  body = await page.evaluate(() => document.body.innerText);
  check("…and still sees their child at the OTHER business",
    body.includes("SuspendCov Keep Kid"), body.slice(0, 400));
  check("…and the suspended business's child is GONE (the dark half, in a browser)",
    !body.includes("SuspendCov Gone Kid"), body.slice(0, 400));
  await page.screenshot({ path: shot("05-parent-during.png"), fullPage: true });

  // ── 6. Unsuspend ──────────────────────────────────────────────────────────
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, "superadmin@swimsync.test");
  await page.goto(`${ADMIN}/platform`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await row("SuspendCov School").getByText("Unsuspend", { exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Unsuspend this business", exact: true }).click();
  await page.waitForTimeout(4000);
  check("the suspended badge is gone",
    !(await row("SuspendCov School").innerText()).includes("suspended"));
  await page.screenshot({ path: shot("06-unsuspended.png"), fullPage: true });

  // ── 7. Staff return; the pre-disabled coach does NOT (⚠ RISK 3) ───────────
  check("the admin's login WORKS again (the unban half)",
    (await adminLoginDies("ts-admin@swimsync.test")) === false);
  check("⚠ RISK 3 — the coach disabled BEFORE the suspend is STILL dead after the unsuspend",
    (await appLoginDies("ts-coach@swimsync.test")) === true);
  await page.screenshot({ path: shot("07-coach-still-dead.png"), fullPage: true });
} finally {
  // ⚠ RISK 9: never leave a suspended tenant on the shared DB, whatever
  // happened above. Idempotent — harmless after a successful UI unsuspend.
  try { sqlUnsuspend(); } catch (e) {
    console.error("RISK 9 fallback unsuspend FAILED — run the teardown now:", e.message);
  }
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
