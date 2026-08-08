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

// ─────────────────────────────────────────────────────────────────────────────
// VISIBILITY-SCOPED HELPERS
//
// React Navigation keeps the screens you left MOUNTED. `document.body.innerText`
// and a bare `getByText` therefore see the previous screen as well as the
// current one (§7.10/§7.58) — which has caused a false FAIL (a press landing on
// a stale screen's button) and, worse, a false PASS (an assertion matching text
// that belongs to the screen you navigated away from).
//
// The seam is `aria-hidden="true"`, which React Navigation puts on the inactive
// screen, plus a non-zero box for anything display:none. Defined ONCE here:
// these used to be copy-pasted per driver, so a fix to the seam reached one
// driver and not the others.
// ─────────────────────────────────────────────────────────────────────────────

/** The `visible` predicate, as source, for injection into page.evaluate. */
const VISIBLE_FN = `(e) => !e.closest('[aria-hidden="true"]') && e.getClientRects().length > 0`;

/**
 * innerText of the VISIBLE screen only.
 *
 * Use this instead of dumpText for any assertion that could be satisfied by a
 * screen you are no longer on — which is every NEGATIVE assertion, and every
 * positive one whose string is not unique to the screen under test.
 */
export async function visibleText(page) {
  return page.evaluate((visibleSrc) => {
    const visible = eval(visibleSrc);
    return [...document.body.querySelectorAll("*")]
      .filter((e) => e.children.length === 0 && visible(e))
      .map((e) => e.textContent.trim())
      .filter(Boolean)
      .join("\n");
  }, VISIBLE_FN);
}

/**
 * Press an RN-web Pressable by its exact label text.
 *
 * `click({force:true})` is not enough (§7.58): the screen you navigated away
 * from stays mounted and can be laid out ON TOP, so a coordinate click lands on
 * the wrong element and the run reads as "the save is broken". Dispatching
 * events on the element itself sidesteps coordinates entirely.
 *
 * ⚠ `includeHidden` EXISTS BECAUSE THE TWO NAVIGATION STYLES NEED OPPOSITE
 * ANSWERS, AND CONSOLIDATING THEM WITHOUT IT COST TWO RED CHECKS (2026-08-08).
 *
 *   • IN-APP navigation (default, includeHidden: false). Screens you left stay
 *     mounted, so an unfiltered search finds the PREVIOUS lesson's buttons
 *     first and presses those. Filtering to the visible screen is what makes
 *     verify-stale-screen.mjs correct.
 *
 *   • DEEP LINK (includeHidden: true). `page.goto` into a nested route mounts
 *     the target screen, but the root layout's session restore then replaces
 *     the route with the coach's landing tab — so the screen under test renders
 *     fully (it has a layout box) while sitting inside an `aria-hidden`
 *     subtree, and the tab is what is "visible". Filtering it out presses
 *     nothing at all. verify-attendance-guard.mjs navigates this way
 *     throughout, which is why it always had its own unfiltered copy.
 *
 * If you are unsure which you need: the default is the safe one, and a press
 * that returns false is a loud failure rather than a wrong press.
 */
export async function pressByText(page, label, index = 0, { includeHidden = false } = {}) {
  const ok = await page.evaluate(
    ({ label, index, visibleSrc, includeHidden }) => {
      const visible = eval(visibleSrc);
      const hits = [...document.querySelectorAll("*")].filter(
        (e) =>
          e.children.length === 0 &&
          e.textContent.trim() === label &&
          (includeHidden || visible(e))
      );
      const el = hits[index];
      if (!el) return false;
      const target = el.parentElement;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
      target.dispatchEvent(new PointerEvent("pointerdown", opts));
      target.dispatchEvent(new PointerEvent("pointerup", opts));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    },
    { label, index, visibleSrc: VISIBLE_FN, includeHidden }
  );
  console.log(`pressed: ${label}${ok ? "" : " (NOT FOUND)"}`);
  return ok;
}

/**
 * Press the action button inside the card for a named class.
 *
 * Scoped to the CARD, not to an index into the whole page. An index broke the
 * moment a finished class started saying "Edit attendance" instead of "Mark
 * Attendance": class B's button moved from index 1 to index 0 and the driver
 * pressed the wrong card.
 *
 * ⚠ WHY IT PRESSES ONLY ON A UNIQUE MATCH, AND WHY THE BOUND IS NOT THE GUARD.
 * This walks UP from the title looking for a button, and the obvious repair
 * when a layout nests cards deeper is to raise the bound. That is worse than
 * the bug it fixes: widen the walk far enough and the ancestor becomes the
 * section wrapper or the ScrollView, at which point `find` returns the FIRST
 * button in document order — a different card's — and the driver presses a
 * stranger's button while reporting success. So each level collects ALL
 * matches and presses only when there is exactly ONE; more than one means the
 * walk has left the card, which returns false loudly instead. With that in
 * place the bound is just a stop condition and can be generous.
 */
export async function pressClassButton(page, classTitle, maxLevels = 12) {
  const ok = await page.evaluate(
    ({ classTitle, maxLevels, visibleSrc }) => {
      const visible = eval(visibleSrc);
      // ⚠ EVERY occurrence of the title, not just the first. A class name can
      // legitimately appear more than once on one screen — the coach Schedule
      // tab lists the same class under NEEDS MARKING (labelled "Mark") and
      // again under TODAY (labelled "Mark Attendance"). Taking only the first
      // match starts the walk inside a card that has no action button, climbs
      // out of it, and then sees every other card's button at once.
      const titles = [...document.querySelectorAll("*")].filter(
        (e) =>
          e.children.length === 0 &&
          e.textContent.trim() === classTitle &&
          visible(e)
      );
      if (titles.length === 0) return false;

      for (const title of titles) {
        let card = title;
        for (let i = 0; i < maxLevels && card; i++) {
          const btns = [...card.querySelectorAll("*")].filter(
            (e) =>
              e.children.length === 0 &&
              /^(Mark Attendance|Edit attendance)$/.test(e.textContent.trim()) &&
              visible(e)
          );
          // More than one means the walk has climbed OUT of this card and is
          // now seeing its neighbours'. Abandon this candidate — never press,
          // because the first match in document order belongs to whichever
          // card happens to be highest, not to the class we were asked for.
          if (btns.length > 1) break;
          // ⚠ ONE BUTTON IS NOT PROOF IT IS *THIS* CARD'S BUTTON. A subtree can
          // hold exactly one action button and still not be this class's card:
          // on the Schedule tab a class appears in NEEDS MARKING (whose row is
          // labelled "Mark", which the regex above ignores) and again under
          // TODAY. Walking up from the NEEDS MARKING copy climbs to the scroll
          // container, finds the single "Mark Attendance" belonging to a
          // DIFFERENT class, presses it and returns true. Require the subtree to
          // contain exactly one copy of the requested TITLE as well, which is
          // only true once we are inside one card.
          const titlesHere = [...card.querySelectorAll("*")].filter(
            (e) =>
              e.children.length === 0 &&
              e.textContent.trim() === classTitle &&
              visible(e)
          );
          if (btns.length === 1 && titlesHere.length > 1) break;
          if (btns.length === 1) {
            const target = btns[0].parentElement;
            const o = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
            target.dispatchEvent(new PointerEvent("pointerdown", o));
            target.dispatchEvent(new PointerEvent("pointerup", o));
            target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            return true;
          }
          card = card.parentElement;
        }
      }
      return false;
    },
    { classTitle, maxLevels, visibleSrc: VISIBLE_FN }
  );
  console.log(`pressed card button: ${classTitle}${ok ? "" : " (NOT FOUND / AMBIGUOUS)"}`);
  return ok;
}
