// SMOKE, app twin: open EVERY coach / parent / public screen once and prove it
// rendered — the right screen, not a crash. The admin twin is
// verify-smoke-admin.mjs; read its header for why these exist (playbook §7.3:
// the feature-tier rollout batches its driver run, and a batch whose net is
// "none" has no net).
//
// WHAT IT ASSERTS, PER SCREEN:
//   1. a string UNIQUE TO THAT SCREEN is on the page after it settles. RN-web
//      has no <h1>, so this is the screen's own heading literal, read from its
//      source. It reads document.body.innerText INCLUDING aria-hidden subtrees,
//      on purpose: a deep-linked screen mounts fully but the root layout's
//      session restore then replaces the route with the landing tab, leaving
//      the screen under test inside an aria-hidden subtree (lib.mjs, the
//      includeHidden note). Every string here is unique to its screen, so the
//      landing tab cannot satisfy it;
//   2. no uncaught exception and no console.error while it loaded, with the
//      URL of any failed request attached so a 400 names its call.
//
// HOW EACH SCREEN IS REACHED — three ways, because the root layout gates them
// three ways (app/_layout.tsx):
//   • deep link, signed in — most tabs and detail screens;
//   • IN-APP press — the Home stack (child / edit-child / join-tenant), because
//     the landing tab IS /home and the replace pops a nested screen off the
//     same stack; and Register / Forgot password, because a session-less load
//     of anything outside PUBLIC_PATHS bounces to /login;
//   • a `#type=recovery` / `#type=invite` hash on a signed-in load — the two
//     token screens, which the root layout routes to on that flag alone.
//
// Two screens are visited in their HANDLED-ERROR state on purpose and say so
// inline — the grade screen with no student, the package page with no token —
// because a rendered refusal still proves the screen mounts without throwing,
// and seed data has neither entity. The parent's child, invoice and public
// token come from the fixture.
//
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-payment-collection.sql
//   supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
//   node drivers/verify-smoke-app.mjs
//
// run-all-drivers.sh maps this driver to fixtures-payment-collection.sql.
import { execSync } from "node:child_process";
import { launch, loginExpo, gotoAuthed, pressByText, EXPO } from "./lib.mjs";

const OUT = process.env.SHOT_DIR || "/tmp";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:54321";

const { createClient } = await import(
  new URL(
    "../../../../SwimSyncAdmin/node_modules/@supabase/supabase-js/dist/index.mjs",
    import.meta.url
  ).href
);

function serviceKey() {
  if (process.env.SERVICE_ROLE_KEY) return process.env.SERVICE_ROLE_KEY;
  const env = execSync("supabase status -o env", { encoding: "utf8" });
  const m = env.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m);
  if (!m) throw new Error("SERVICE_ROLE_KEY not in env and not in `supabase status`");
  return m[1];
}

// fixtures-payment-collection.sql — ids are fixed there.
const KID_NAME = "Pay Driver Kid";
const INVOICE = "da100000-0000-0000-0000-0000000000c1";
const TOKEN = "da100000c0ffee00da100000c0ffee00";
const PARENT = "pay-driver-parent@swimsync.test";

// Errors this driver IGNORES, each with the reason. Keep this list short and
// every entry exact — an allowlist is where a real crash goes to hide.
const IGNORED_ERRORS = [
  // NativeWind 4 throws this on every web load (its own dark-mode probe; the
  // app never sets a colour scheme). Chronic, harmless to the render, and NOT
  // ours to fix here — filed in BACKLOG. Exact message, so a different throw
  // from the same library still fails.
  "Cannot manually set color scheme, as dark mode is type 'media'",
];

const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function nextDateFor(dayOfWeek) {
  const sg = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const want = DOW.indexOf(dayOfWeek);
  const ahead = (want - sg.getDay() + 7) % 7 || 7;
  sg.setDate(sg.getDate() + ahead);
  return `${sg.getFullYear()}-${String(sg.getMonth() + 1).padStart(2, "0")}-${String(sg.getDate()).padStart(2, "0")}`;
}

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

let errors = [];
let failedRequests = [];
function watch(page) {
  const ignored = (msg) => IGNORED_ERRORS.some((s) => msg.includes(s));
  page.on("pageerror", (e) => { if (!ignored(e.message)) errors.push(`pageerror: ${e.message}`); });
  page.on("console", (m) => { if (m.type() === "error" && !ignored(m.text())) errors.push(`console.error: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().replace(API_URL, "")}`); });
}

// `expectedFailure`: a RegExp for the ONE request a handled-error screen is
// expected to see refused (a 406 for a missing row, a 404 for a bad token).
// Chrome logs every 4xx as a console.error ("Failed to load resource"), so
// with it set that log line is dropped IF every failed request matched the
// pattern — any other failure, or a real throw, still fails the check.
async function settleAndAssert(page, label, expected, expectedFailure) {
  // Poll rather than read once: a deep-linked screen renders nothing until the
  // session restores (its data effect keys on the session id), and one read at
  // a fixed delay was flaky on /profile/contact — green, then red, no change.
  const matches = (t) => (expected instanceof RegExp ? expected.test(t) : t.includes(expected));
  let text = "";
  for (let i = 0; i < 10; i++) {
    text = await page.evaluate(() => document.body.innerText);
    if (matches(text)) break;
    await page.waitForTimeout(1000);
  }
  const name = label.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  await page.screenshot({ path: `${OUT}/smoke-app-${name}.png`, fullPage: true });
  const ok = matches(text);
  check(ok, `${label} renders ${expected instanceof RegExp ? expected : `"${expected}"`}`,
    ok ? "" : `on ${page.url()} — text began: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
  let errs = errors;
  if (expectedFailure && failedRequests.length > 0 && failedRequests.every((r) => expectedFailure.test(r))) {
    errs = errors.filter((e) => !/^console\.error: Failed to load resource/.test(e));
  }
  check(errs.length === 0, `${label} loaded with no page/console error`,
    [...errs.slice(0, 3), ...failedRequests.slice(0, 3)].join(" | "));
}

// `expected` is a string (exact substring) or a RegExp.
async function visit(page, route, expected, { authed = true, expectedFailure } = {}) {
  errors = []; failedRequests = [];
  if (authed) await gotoAuthed(page, `${EXPO}${route}`);
  else { await page.goto(`${EXPO}${route}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000); }
  await settleAndAssert(page, route, expected, expectedFailure);
}

// Press a label on the CURRENT (visible) screen and assert the screen it
// opens. Visible-only, deliberately: a deep-linked screen that the landing
// replace has hidden must not be pressed into — its buttons are not what the
// user can reach.
async function visitByPress(page, label, expected, routeName) {
  errors = []; failedRequests = [];
  const pressed = await pressByText(page, label);
  if (!pressed) { check(false, `${routeName} — "${label}" was not on the screen to press`); return; }
  await page.waitForTimeout(2500);
  await settleAndAssert(page, routeName, expected);
}

// Deep-link a route and assert ONLY that nothing errored while it mounted.
async function visitErrorsOnly(page, route) {
  errors = []; failedRequests = [];
  await gotoAuthed(page, `${EXPO}${route}`);
  await page.waitForTimeout(3000);
  check(errors.length === 0, `${route} (hard reload) fired no failing request and no error`,
    [...errors.slice(0, 3), ...failedRequests.slice(0, 3)].join(" | "));
}

async function signOut(page) {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
}

const { browser, page } = await launch({ mobile: true, headless: true });
watch(page);

try {
  const svc = createClient(API_URL, serviceKey());
  const { data: cls, error } = await svc
    .from("classes").select("id, day_of_week").eq("title", "Saturday Beginners").single();
  if (error || !cls) throw new Error(`seed class not found: ${error?.message}`);
  const lessonDate = nextDateFor(cls.day_of_week);

  console.log("\n[coach] every coach screen");
  await loginExpo(page, "coach@swimsync.test");
  await visit(page, "/schedule", "Good morning,");
  await visit(page, "/classes", "My Classes");
  await visit(page, `/classes/${cls.id}/roster`, "Saturday Beginners");
  await visit(page, `/classes/${cls.id}/attendance?date=${lessonDate}&from=roster`, "Mark Attendance");
  // Seed has no student, so this is the screen's handled-error state — it
  // still proves the route mounts and settles without throwing.
  await visit(page, `/classes/${cls.id}/grade?studentId=00000000-0000-0000-0000-000000000000`, "Could not load this child.",
    { expectedFailure: /^406 \/rest\/v1\/students\?.*id=eq\.00000000/ });
  await visit(page, "/pay", "My Pay");
  await visit(page, "/settings", "Account Details");
  // A deep-linked TAB is mounted but hidden once the landing replace lands on
  // /schedule, so to press INTO it the tab is opened from the tab bar first.
  await visit(page, "/schedule", "Good morning,");
  await visitByPress(page, "Settings", "Account Details", "/settings (tab)");
  await visitByPress(page, "Change Password", "Confirm New Password", "/settings/change-password");

  console.log("\n[parent] every parent screen");
  await signOut(page);
  await loginExpo(page, PARENT);
  await visit(page, "/home", "Welcome back,");
  await visitByPress(page, KID_NAME, "Child Profile", "/home/child/[id]");
  await visitByPress(page, "Edit", "Edit Child", "/home/edit-child");
  // The Home stack is walked by PRESSING, not deep-linking: /home is the
  // landing tab, so a deep link into the stack is popped back to it (the
  // screen stays mounted but hidden, and hidden buttons are not pressable).
  await visit(page, "/home", "Welcome back,");
  await visitByPress(page, "Add Child", "Additional Notes", "/home/add-child");
  await visitByPress(page, "+ Add another coach or school", "Join your coach", "/home/join-tenant");
  await visit(page, "/attendance", "Attendance");
  await visit(page, "/billing", "Billing");
  await visit(page, `/billing/invoice/${INVOICE}`, "Invoice Detail");
  await visit(page, `/billing/paynow?invoiceId=${INVOICE}`, "PayNow Payment");
  // The Profile stack likewise — a deep link into it is replaced by the landing
  // tab before the screen's data effect can run. The menu labels equal the
  // screens' titles, so the assertion strings are field labels instead.
  await visit(page, "/profile", "Account Details");
  await visit(page, "/home", "Welcome back,");
  await visitByPress(page, "Profile", "Account Details", "/profile (tab)");
  await visitByPress(page, "Contact Details", "Postal Code", "/profile/contact");
  await visit(page, "/home", "Welcome back,");
  await visitByPress(page, "Profile", "Account Details", "/profile (tab)");
  await visitByPress(page, "Change Password", "Confirm New Password", "/profile/change-password");
  // REGRESSION PIN, errors only: a hard reload of /profile/contact used to fire
  // two `eq.undefined` 400s before the session restored (fixed 2026-09-13).
  // The render is not asserted here — the landing replace may pop the screen
  // — but the requests it fires while mounted are what the bug was.
  await visitErrorsOnly(page, "/profile/contact");
  // The two token screens: the root layout routes a signed-in load to them on
  // the URL flag alone, which is the only way to reach them without a real
  // recovery/invite email.
  await visit(page, "/reset-password#type=recovery", "Set New Password");
  await visit(page, "/accept-invite#type=invite", "Welcome to SwimSync");

  console.log("\n[logged out] the auth and public pages");
  await signOut(page);
  await visit(page, "/login", "Sign In", { authed: false });
  await visitByPress(page, "Register", "Create Account", "/register");
  await visit(page, "/login", "Sign In", { authed: false });
  await visitByPress(page, "Forgot password?", "Reset Password", "/forgot-password");
  await visit(page, "/welcome", "Welcome to SwimSync", { authed: false });
  await visit(page, `/invoice/${TOKEN}`, "Amount due", { authed: false });
  // No package in the fixture: the not-found state is the rendered screen.
  await visit(page, "/package/00000000000000000000000000000000", "Package not found",
    { authed: false, expectedFailure: /^404 \/functions\/v1\/public-package\?token=0000/ });

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: `${OUT}/smoke-app-error.png` });
  process.exitCode = 1;
} finally {
  await browser.close();
}
