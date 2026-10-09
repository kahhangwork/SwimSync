// Reusable Playwright helpers for driving SwimSync's UIs against installed Chrome.
// See ../SKILL.md for the gotchas these encode.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

// Overridable because Next picks the next free port when 3000 is taken (a
// stale dev server from another session is the usual cause), and Expo does the
// same. Run e.g. ADMIN_URL=http://localhost:3001 node drivers/<driver>.mjs
export const ADMIN = process.env.ADMIN_URL ?? "http://localhost:3000";
export const EXPO = process.env.EXPO_URL ?? "http://localhost:8081";

// ⚠ EVERY DATE LABEL A DRIVER COMPARES AGAINST THE SCREEN IS BUILT HERE — and
// check-driver-dates.sh fails CI if one is built anywhere else. Postgres
// `to_char(d,'Mon')` and Node's en-US both say "Sep"; the apps render en-SG,
// whose CLDR month for September is "Sept". They agree eleven months a year, so
// every copy of the wrong formatter passed review and went red the first time
// its date reached September — four times (§7.121, §7.215, §7.225, §7.302).
// This is the app's own call (formatSgDate in both apps' lib/lessonDates.ts):
// parse a "YYYY-MM-DD" as UTC, render en-SG in UTC, so the label is that date.
/** "Sat, 18 Jul" by default — formatSgDate's default options. */
export const sgLabel = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-SG", { ...opts, timeZone: "UTC" });
/** "Sept 2026" for a billing month "2026-09" — the admin's formatBillingMonth. */
export const sgMonthLabel = (ym) => sgLabel(`${ym.slice(0, 7)}-01`, { month: "short", year: "numeric" });

// ─────────────────────────────────────────────────────────────────────────────
// THE CLOCK — the ONE place a driver reads "now" (docs/plans/PIN_DRIVER_CLOCK_PLAN.md)
//
// `run-all-drivers.sh --now '<ts+offset>'` pins the whole stack to one past
// moment: Postgres (a database-level swimsync.now, so fixtures, sql() and the API
// all read it through app_now()), the billing engine (it asks the DB), and the
// browser (every context on launch()'s browser is fixed to the same instant).
// The runner passes the pin here as DRIVER_NOW, already canonicalised by Postgres
// to "YYYY-MM-DDTHH:MM:SSZ" — Node never parses a user-typed pin ("…T07:59+08"
// is an Invalid Date in V8).
//
// Unpinned (no DRIVER_NOW) every helper is exactly the real clock: nowSg() IS
// new Date(), so the nightly is unchanged.
//
// check-driver-clock.sh fails CI if a `// clock: pinnable` driver reads the
// clock any other way — new Date() / Date.now(), its own chromium.launch(), a
// clock.install, or a raw now()/CURRENT_DATE in its SQL.
// ─────────────────────────────────────────────────────────────────────────────

const DB_CONTAINER = "supabase_db_SwimSync";

/** Run one SQL statement as postgres on the local stack; trimmed `-At` output.
 *  No shell, so a query needs no quote-escaping. Under --now this session is
 *  pinned by the database-level default: read the time with app_now() /
 *  app_today(), never now() / CURRENT_DATE. */
export const sql = (q) =>
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", q],
    { encoding: "utf8" }
  ).trim();

export const PIN = process.env.DRIVER_NOW ?? null;
const PIN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PIN_MS = PIN === null ? null : Date.parse(PIN);

/** The current instant: the pin under --now, otherwise exactly `new Date()`. */
export const nowSg = () => (PIN_MS === null ? new Date() : new Date(PIN_MS));
/** Today's date in Singapore, "YYYY-MM-DD" (en-CA is ISO-shaped). */
export const todaySg = () => nowSg().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
/** Pure calendar arithmetic on a "YYYY-MM-DD"; n may be negative. */
export const addDaysIso = (iso, n) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ⚠ REFUSE TO RUN HALF-PINNED, AT IMPORT, IN BOTH DIRECTIONS. A browser on the
// pin beside a database on the real clock (or the reverse) produces a world that
// never existed, and its PASS means nothing. So every driver — they all import
// this file — checks the stack before its first step:
//   DRIVER_NOW set   → the DB's app_now() IS the pin AND the API row is present
//                      (else the browser would be pinned and PostgREST real).
//   DRIVER_NOW unset → no swimsync.now default AND no API row: a killed --now run
//                      leaves the stack pinned, and the dev apps would silently
//                      run on a fake day.
// to_regclass: the API-row table arrives with its own migration; before it
// exists there is no row, by definition.
{
  let state;
  try {
    const [setting, epoch, hasTable] = sql(
      "SELECT coalesce(current_setting('swimsync.now', true), '') || '|' || extract(epoch FROM app_now()) || '|' || " +
        "(to_regclass('private.clock_api_pin_enabled') IS NOT NULL)"
    ).split("|");
    const apiRows = hasTable === "t" ? Number(sql("SELECT count(*) FROM private.clock_api_pin_enabled")) : 0;
    state = { setting, epochMs: Math.round(Number(epoch) * 1000), apiRows };
  } catch (e) {
    throw new Error(`lib.mjs: could not read the stack's clock state (is the local stack up?) — ${e.message}`);
  }
  if (PIN !== null) {
    if (!PIN_RE.test(PIN) || !Number.isFinite(PIN_MS) || state.epochMs !== PIN_MS || state.apiRows !== 1) {
      throw new Error(
        `DRIVER_NOW is set but the stack is not pinned — use run-all-drivers.sh --now ` +
          `(DRIVER_NOW=${JSON.stringify(PIN)}, db app_now epoch ms=${state.epochMs}, API rows=${state.apiRows})`
      );
    }
  } else if (state.setting !== "" || state.apiRows !== 0) {
    throw new Error(
      `a stale clock pin is on this stack — run scripts/clock-unpin.sh ` +
        `(swimsync.now=${JSON.stringify(state.setting)}, API rows=${state.apiRows})`
    );
  }
}

/** Fix a browser context to the pin (no-op unpinned), then PROVE it: a page of
 *  this context must read Date.now() === the pin. Frozen, not flowing — the DB
 *  pin is a fixed instant, and a flowing browser beside it could cross 08:00 or
 *  midnight mid-driver. Timers still run (setFixedTime holds only Date). */
export async function pinBrowser(context) {
  if (PIN_MS === null) return context;
  await context.clock.setFixedTime(PIN_MS);
  const probe = await context.newPage();
  try {
    const seen = await probe.evaluate(() => Date.now());
    if (seen !== PIN_MS) throw new Error(`pinBrowser: browser Date.now()=${seen}, want the pin ${PIN_MS} (${PIN})`);
  } finally {
    await probe.close();
  }
  return context;
}

/** Set a context's browser clock to a moment the DRIVER DERIVED from the
 *  database — e.g. "the Wednesday after the fixture's missing Saturday" — rather
 *  than to now. The fixture's dates follow app_today(), so under --now the moment
 *  follows the pin and the run is the one the real clock gives on that day. It is
 *  exactly `context.clock.install({ time })` (a flowing clock), overriding
 *  pinBrowser's fixed pin for this context; check-driver-clock.sh refuses a bare
 *  clock.install in a pinnable driver, so this is the one sanctioned way. Never
 *  pass a moment derived from the real clock — that is what nowSg() is for. */
export async function installDerivedClock(context, time) {
  await context.clock.install({ time });
  return context;
}

/** The browser, WRAPPED: every context made by newContext() / newPage() is
 *  pinned before the driver sees it. Pinning is a property of the handle, not a
 *  call a driver must remember — 14 drivers open extra contexts. */
function pinnedBrowser(browser) {
  return new Proxy(browser, {
    get(target, prop) {
      if (prop === "newContext") {
        return async (...args) => pinBrowser(await target.newContext(...args));
      }
      if (prop === "newPage") {
        // browser.newPage() makes its own one-page context: pin that context
        // before the page loads anything, and close it with the page, as
        // Playwright's own newPage() does.
        return async (...args) => {
          const ctx = await pinBrowser(await target.newContext(...args));
          const page = await ctx.newPage();
          page.once("close", () => ctx.close().catch(() => {}));
          return page;
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** Launch Chrome. mobile=true gives a phone viewport for the Expo app. The
 *  returned browser is the wrapped, pinned one — never call chromium.launch(). */
export async function launch({ mobile = false, headless = true } = {}) {
  const browser = pinnedBrowser(await chromium.launch({ channel: "chrome", headless }));
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

/** ONE Expo login attempt; true if it STAYED on /login (banned/dead), false if
 *  it left. Returns null when the form never appeared — "cannot say", not a
 *  verdict; pass the result through loginVerdictDetail() so a check prints it.
 *
 *  ONE press, no retry, on purpose: retrying is what loginExpo does and why it
 *  hides a login regression (§7.263). Only the wait for the FORM is generous —
 *  it waits for the email field itself, not a fixed 7 s, because the nightly's
 *  first cold load could outlast the timer and red a login control (§7.262). */
export async function appLoginDies(page, email, password = "password123") {
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  const emailField = page.getByPlaceholder("you@email.com");
  try {
    await emailField.waitFor({ state: "visible", timeout: 45000 }); // Metro hydrate, cold compile included
    await emailField.fill(email, { timeout: 5000 });
    await page.locator('input[type="password"]').fill(password, { timeout: 5000 });
  } catch {
    console.log(`appLoginDies: the login form never became fillable for ${email}`);
    return null;
  }
  await page.getByText("Sign In").last().click();
  await page.waitForTimeout(6000);
  return new URL(page.url()).pathname.endsWith("/login");
}

/** A check's detail for an appLoginDies result: names a null as "cannot say",
 *  so a form that never loaded doesn't read as a login verdict. */
export const loginVerdictDetail = (died) =>
  died === null
    ? "CANNOT SAY — the login form never appeared (a load failure, not a login verdict; §7.262)"
    : `appLoginDies returned ${died}`;

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
 * Press a Pressable whose label MATCHES a pattern, on the VISIBLE screen only.
 *
 * `pressByText` needs the exact string, which a label carrying a date cannot
 * give: the roster's button reads "Mark Attendance — Sat, 8 Aug". Same
 * visibility rule and the same reason (§7.98) — the screen you left stays
 * mounted, so a raw `page.getByText(...).first()` resolves to ITS copy of the
 * button, which is hidden, and Playwright then waits for a visibility that
 * never comes. The driver dies on a TIMEOUT rather than on an assertion, which
 * reads as "the button is gone" when the button is fine.
 *
 * Presses only on a UNIQUE visible match, per §7.98's walk rule: more than one
 * means the pattern is too loose, and pressing hits[0] would be picking a
 * stranger's button while reporting success.
 */
export async function pressByTextMatch(page, pattern, { includeHidden = false } = {}) {
  const res = await page.evaluate(
    ({ source, flags, visibleSrc, includeHidden }) => {
      const visible = eval(visibleSrc);
      // ⚠ `g` STRIPPED. One RegExp is reused across every element, and a global
      // one carries `lastIndex` from call to call — `.test()` would resume
      // mid-string and skip roughly every other match, silently. The count this
      // function returns is the whole safety property, so it must not depend on
      // which flags the caller happened to type.
      const re = new RegExp(source, flags.replace(/[gy]/g, ""));
      const hits = [...document.querySelectorAll("*")].filter(
        (e) =>
          e.children.length === 0 &&
          re.test(e.textContent.trim()) &&
          (includeHidden || visible(e))
      );
      if (hits.length !== 1) return { ok: false, n: hits.length };
      const target = hits[0].parentElement;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
      target.dispatchEvent(new PointerEvent("pointerdown", opts));
      target.dispatchEvent(new PointerEvent("pointerup", opts));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return { ok: true, n: 1 };
    },
    { source: pattern.source, flags: pattern.flags, visibleSrc: VISIBLE_FN, includeHidden }
  );
  console.log(
    `pressed: /${pattern.source}/${res.ok ? "" : ` (${res.n} visible matches, need exactly 1)`}`
  );
  return res.ok;
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

// ── Table column geometry ───────────────────────────────────────────────────
// LIFTED VERBATIM from verify-levels-table.mjs on 2026-08-09 so more than one
// of the sixteen admin tables can be measured.
//
// ⚠ THAT DRIVER STILL HAS ITS OWN INLINE COPY, AND DELIBERATELY SO. It was NOT
// rewritten to import this — it is the CALIBRATED REFERENCE, measured against a
// real 488px-broken page, and an edit to this shared helper must not be able to
// change what it asserts (its 12/12 is the regression baseline). So there are
// two copies on purpose. If you change the measurement here, re-measure there
// before assuming they still agree — §7.98 is exactly the cost of assuming two
// "identical" helpers are identical.
//
// WHY GEOMETRY AND NOT TEXT. levels/page.tsx once wrapped its <Th>s in a <Tr>
// while <Thead> already emitted one, producing <tr> inside <tr>: the headers
// collapsed into a single anonymous cell and drifted hundreds of pixels from
// the data they name. EVERY TEXT ASSERTION PASSED — the labels were present,
// correctly spelled, in the right order, and in the wrong place. It shipped
// visibly broken for a week (§7.54). So this measures rects from the DOM.
//
// CALIBRATION — measured, not guessed (1280px viewport):
//   broken → worst header/data offset 488px    fixed → 0px
// TOLERANCE is 2px: a ~244x margin against the broken value while still
// absorbing sub-pixel layout and font rounding. DO NOT raise it without
// re-measuring the broken case — a tolerance that no longer separates the two
// states is a check that has quietly stopped checking.
//
// ⚠ DO NOT "improve" this by asserting on React's validateDOMNesting warning.
// Against the known-broken page React logged NOTHING and that check passed —
// a green tick on a page that was visibly wrong.
export const TABLE_GEOMETRY_TOLERANCE = 2; // px — see CALIBRATION above

// Measures the first table on the page. Returns null when there is nothing to
// measure — no <table>, or no data row with more than one cell (an empty state
// renders a single full-width "nothing here" cell, which has no column to be
// misaligned against). A null is a SKIP, and a skip must be logged and must
// never be counted as a pass: a page reported as "checked" when it had no rows
// is exactly how §7.54 survived a week, and how §7.100 survived two weeks.
export async function measureTableGeometry(page) {
  return page.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) return null;
    const ths = [...table.querySelectorAll("thead th")];
    if (ths.length === 0) return null;
    const firstDataRow = [...table.querySelectorAll("tbody tr")].find(
      (tr) => tr.querySelectorAll("td").length > 1
    );
    if (!firstDataRow) return null;
    const tds = [...firstDataRow.querySelectorAll("td")];
    return {
      headerTexts: ths.map((t) => t.innerText.trim()),
      thCount: ths.length,
      tdCount: tds.length,
      nestedTrInThead: table.querySelectorAll("thead tr tr").length,
      cols: ths.map((th, i) => ({
        header: th.innerText.trim(),
        thLeft: Math.round(th.getBoundingClientRect().left),
        tdLeft: tds[i] ? Math.round(tds[i].getBoundingClientRect().left) : null,
        // Width is REPORTED, never asserted. §7.71: a table whose columns all
        // carry `w-full` renders one of them at ~110px while every text
        // assertion still passes. Alignment cannot see that — the header and
        // its data are both squeezed, together — so a caller prints narrow
        // columns for a human and does not fail on them.
        thWidth: Math.round(th.getBoundingClientRect().width),
      })),
    };
  });
}

// Settle the page before measuring. A webfont landing between layout and
// measurement is the likeliest source of drift in every number above.
export async function settleForMeasurement(page, ms = 300) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}
