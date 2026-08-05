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

/** Log into the Expo app. Handles the Sign-In heading/button text collision.
 *
 * RETRIES, because one shot is a flake under load: on the CI runner a single
 * driver (verify-stale-screen, run 31011697069) lost the 15s race once, stayed
 * on /login silently, and all 16 downstream checks cascaded red while the same
 * login worked in 20 sibling drivers. Three attempts, and a loud throw rather
 * than a silent continue — a driver cannot do anything useful unauthenticated,
 * so failing here with the real reason beats 16 misleading FAILs. */
export async function loginExpo(page, email, password = "password123") {
  // "Authed" = on the APP, off /login. The origin check is load-bearing: a
  // fresh page is about:blank, whose pathname also doesn't end in /login — a
  // path-only check declared victory before ever navigating and skipped the
  // whole login ("loginExpo -> about:blank", two drivers red, 2026-08-05).
  const authed = () => {
    const u = new URL(page.url());
    return u.origin === new URL(EXPO).origin && !u.pathname.endsWith("/login");
  };
  for (let attempt = 1; attempt <= 3 && !authed(); attempt++) {
    await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000); // Metro hydrate
    // A slow PREVIOUS attempt can complete after its window closed: the
    // session then exists and this goto bounces straight off /login — that is
    // a success, and filling a form that is no longer there was run
    // 31016327691's crash (two drivers, "waiting for you@email.com").
    if (authed()) break;
    try {
      await page.getByPlaceholder("you@email.com").fill(email, { timeout: 10000 });
      await page.locator('input[type="password"]').fill(password, { timeout: 5000 });
    } catch {
      await page.waitForTimeout(3000);
      if (authed()) break; // redirect landed mid-fill — logged in after all
      console.log(`loginExpo: form not ready on attempt ${attempt}`);
      continue; // not hydrated yet — next attempt reloads
    }
    await page.getByText("Sign In").last().click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (!authed()) console.log(`loginExpo: still on /login after attempt ${attempt}`);
  }
  if (!authed()) throw new Error(`loginExpo: ${email} could not log in after 3 attempts`);
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
