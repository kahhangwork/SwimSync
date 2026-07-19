// Reusable Playwright helpers for driving SwimSync's UIs against installed Chrome.
// See ../SKILL.md for the gotchas these encode.
import { chromium } from "playwright-core";

// Overridable because Next picks the next free port when 3000 is taken (a
// stale dev server from another session is the usual cause), and Expo does the
// same. Run e.g. ADMIN_URL=http://localhost:3001 node drivers/<driver>.mjs
export const ADMIN = process.env.ADMIN_URL ?? "http://localhost:3000";
export const EXPO = process.env.EXPO_URL ?? "http://localhost:8081";

/** Launch Chrome. mobile=true gives a phone viewport for the Expo app. */
export async function launch({ mobile = false, headless = true } = {}) {
  const browser = await chromium.launch({ channel: "chrome", headless });
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 420, height: 900 }, isMobile: true }
      : { viewport: { width: 1280, height: 900 } }
  );
  const page = await ctx.newPage();
  // Alert.alert is a no-op on RN-web, but keep this harmless handler.
  page.on("dialog", (d) => { console.log("DIALOG:", d.message()); d.accept().catch(() => {}); });
  return { browser, ctx, page };
}

/** Force-click an RN-web touchable (overlay siblings intercept normal clicks). */
export async function tap(locator, label = "") {
  await locator.first().waitFor({ state: "visible", timeout: 12000 });
  await locator.first().click({ force: true });
  if (label) console.log("tapped:", label);
}

/** Log into the Expo app. Handles the Sign-In heading/button text collision. */
export async function loginExpo(page, email, password = "password123") {
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000); // Metro hydrate
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByText("Sign In").last().click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  console.log("loginExpo ->", page.url());
}

/** Log into the Next.js admin panel. */
export async function loginAdmin(page, email = "superadmin@swimsync.test", password = "password123") {
  await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1500);
  console.log("loginAdmin ->", page.url());
}

/** Expo full-page goto with retry: the store rehydrates from the persisted
 *  Supabase session on reload, but a protected route may briefly bounce to
 *  /login. Prefer in-app navigation; use this only when a deep link is needed. */
export async function gotoAuthed(page, url, { tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    if (!page.url().endsWith("/login")) return;
    console.log("bounced to /login, retrying after rehydration...");
    await page.waitForTimeout(3000);
  }
}

export async function dumpText(page, n = 1200) {
  const t = await page.evaluate(() => document.body.innerText);
  console.log(t.slice(0, n));
  return t;
}
