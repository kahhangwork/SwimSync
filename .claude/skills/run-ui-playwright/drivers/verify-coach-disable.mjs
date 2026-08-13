// Drive coach disable/reactivate end to end (Wave 5 chunk 2, 20260813000200).
//
// What only THIS driver can prove (pgTAP owns the RLS/RPC layer): the BAN half
// — bans live in auth, not the database — in a real browser against the real
// Expo login, plus the dialog's replacement requirement and its ⚠ RISK 8
// marking-backlog list, in the real admin UI.
//
// Setup/Prereqs:
//   supabase start; admin panel on :3000 (or ADMIN_URL); Expo web on :8081
//   (or EXPO_URL). fixture: fixtures-coach-disable.sql — and NOTE the driver
//   consumes state (moves DisableCov Lane to the replacement; reactivation
//   deliberately does NOT hand it back), so a re-run needs
//   fixtures-coach-disable-teardown.sql (or a db reset) first.
//
// Personas (all password123):
//   coach@swimsync.test        seed OWNER (tenant_admin + coach) — the actor
//   dc-target@swimsync.test    pure coach to disable (must be BANNED)
//   dc-replace@swimsync.test   pure coach who inherits the class

import os from "node:os";
import { launch, loginAdmin, loginExpo, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/coach-disable-${n}`;

const results = [];
function check(label, pass, detail = "") {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : ` — ${detail}`}`);
}

const { browser, page } = await launch();

async function freshAdminLogin() {
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, "coach@swimsync.test");
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

// ── 1. The Coaches page, before ─────────────────────────────────────────────
await freshAdminLogin();
await page.goto(`${ADMIN}/coaches`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
let body = await page.evaluate(() => document.body.innerText);

check("both fixture coaches are listed with the target teaching their class",
  body.includes("DisableCov Target") && body.includes("DisableCov Replacement") &&
  (await row("DisableCov Target").innerText()).includes("DisableCov Lane"),
  body.slice(0, 300));
check("an active coach's row offers Disable",
  (await row("DisableCov Target").innerText()).includes("Disable"));
await page.screenshot({ path: shot("01-before.png"), fullPage: true });

// ── 2. The dialog: replacement demanded, ⚠ RISK 8 list shown ────────────────
await row("DisableCov Target").getByText("Disable", { exact: true }).click();
await page.waitForTimeout(2500); // the marking-backlog check loads async
body = await page.evaluate(() => document.body.innerText);

check("the dialog names the class that must be handed over",
  body.includes("They still teach") && body.includes("DisableCov Lane"));
check("⚠ RISK 8 — the dialog lists the unmarked override lesson as the admin's to mark",
  body.includes("Marking these falls to you") && body.includes("DisableCov Other"),
  body.slice(0, 600));

const confirmDisable = page.getByRole("button", { name: "Disable coach", exact: true });
check("the confirm button is dead until a replacement is chosen",
  await confirmDisable.isDisabled());
await page.screenshot({ path: shot("02-dialog.png"), fullPage: true });

// ── 3. Disable, with the replacement chosen ─────────────────────────────────
await page.locator("select").selectOption({ label: "DisableCov Replacement" });
await confirmDisable.click();
await page.waitForTimeout(3500);
body = await page.evaluate(() => document.body.innerText);

check("the target's row now says Disabled",
  (await row("DisableCov Target").innerText()).includes("Disabled"));
check("the class moved to the replacement's row",
  (await row("DisableCov Replacement").innerText()).includes("DisableCov Lane"));
check("a disabled row offers Reactivate, not Disable",
  (await row("DisableCov Target").innerText()).includes("Reactivate"));
await page.screenshot({ path: shot("03-disabled.png"), fullPage: true });

// ── 4. The ban half, in the real app ────────────────────────────────────────
check("the disabled coach's app login DIES (the ban half)",
  (await appLoginDies("dc-target@swimsync.test")) === true);
await page.screenshot({ path: shot("04-login-dead.png"), fullPage: true });

// ── 5. The replacement sees the inherited class ─────────────────────────────
await loginExpo(page, "dc-replace@swimsync.test");
await page.waitForTimeout(2500);
body = await page.evaluate(() => document.body.innerText);
check("the replacement's week shows the inherited class",
  body.includes("DisableCov Lane"), body.slice(0, 400));
await page.screenshot({ path: shot("05-replacement-week.png"), fullPage: true });

// ── 6. Reactivate: authority and login return; the class does NOT ───────────
await freshAdminLogin();
await page.goto(`${ADMIN}/coaches`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await row("DisableCov Target").getByText("Reactivate", { exact: true }).click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: "Reactivate coach", exact: true }).click();
await page.waitForTimeout(3500);

check("the reactivated row no longer says Disabled",
  !(await row("DisableCov Target").innerText()).includes("Disabled"));
check("…and the class was NOT handed back — it stays the replacement's",
  (await row("DisableCov Replacement").innerText()).includes("DisableCov Lane"));
await page.screenshot({ path: shot("06-reactivated.png"), fullPage: true });

check("the reactivated coach's app login WORKS again (the unban half)",
  (await appLoginDies("dc-target@swimsync.test")) === false);

await browser.close();

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
