// SMOKE: open EVERY admin route once and prove it rendered — the right page,
// not a refusal, not a crash. Nothing else.
//
// WHY THIS EXISTS. The route → driver map taken on 2026-09-12 (playbook §7.3)
// showed seven admin pages that NO driver opens at all — credit-notes,
// holidays, accounting, history and the three auth pages — and the feature-tier
// rollout is about to move every one of them into ui/domain/dao tiers in
// batches, with the driver run deferred to the end of each batch. A batch whose
// net is "none" has no net. This is the cheapest possible one, and it is also
// the check that would have caught a page crashing on mount for every role at
// once, which the specialised drivers only notice for the page they own.
//
// WHAT IT ASSERTS, PER ROUTE:
//   1. the page's <h1> is EXACTLY the heading that page renders — an exact match
//      is what makes a wrong-page render, a RequiresTenant refusal ("Not this
//      app" / "Access suspended" / "Not this account") or a blank shell all
//      read as FAIL rather than "some heading was present";
//   2. no uncaught exception (pageerror) and no console.error was logged while
//      it loaded. Next's dev overlay swallows neither, and a render crash on
//      the deployed build is exactly a pageerror here.
//
// WHAT IT DOES NOT ASSERT. Content. The specialised drivers own that; this one
// must stay cheap enough that adding a page to it is a one-line edit.
//
// Supersedes smoke-admin-screens.mjs (four routes, hardcoded port, no exit
// code — it could not fail, so it never ran in the nightly).
//
// Runs on bare seed data — no fixture. Logs in as the seed private coach, who is
// the tenant admin, for the tenant pages; as the platform admin for /platform;
// and logged OUT for the auth pages.
//
//   node drivers/verify-smoke-admin.mjs
//
// SERVICE_ROLE_KEY is read from the env (run-all-drivers.sh exports it) and
// falls back to `supabase status`, so a hand run needs no exported secret.
import { execSync } from "node:child_process";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

// Resolved relative to this file, not an absolute path — the checkout lives
// somewhere else on the CI runner (same as verify-platform-admin.mjs).
const { createClient } = await import(
  new URL(
    "../../../../SwimSyncAdmin/node_modules/@supabase/supabase-js/dist/index.mjs",
    import.meta.url
  ).href
);

const OUT = process.env.SHOT_DIR || "/tmp";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:54321";

function serviceKey() {
  if (process.env.SERVICE_ROLE_KEY) return process.env.SERVICE_ROLE_KEY;
  const env = execSync("supabase status -o env", { encoding: "utf8" });
  const m = env.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m);
  if (!m) throw new Error("SERVICE_ROLE_KEY not in env and not in `supabase status`");
  return m[1];
}

// ── The routes, with the EXACT <h1> each renders ─────────────────────────────
// One entry per page file under app/. A new page is a new line here; a page
// whose heading changes is a one-line edit. Keep the list in NAV order
// (lib/adminNav.ts) so a diff against the sidebar is a visual check.
const TENANT_ROUTES = [
  ["/dashboard",    "Dashboard"],
  ["/unassigned",   "Unassigned Children"],
  ["/classes",      "Classes"],
  ["/students",     "Students"],
  ["/claims",       "Parent Requests"],
  ["/assessment",   "Assessment"],
  ["/levels",       "Swimming Levels"],
  ["/locations",    "Locations"],
  ["/parents",      "Parents"],
  ["/attendance",   "Attendance"],
  ["/calendar",     "Calendar"],
  ["/lessons",      "Lessons"],
  ["/substitutes",  "Substitutes"],
  ["/trials",       "Trials"],
  ["/makeups",      "Make-ups"],
  ["/invoices",     "Invoices"],
  ["/packages",     "Packages"],
  ["/referrals",    "Referrals"],
  ["/holidays",     "Holidays"],
  ["/credit-notes", "Credit Notes"],
  ["/coaches",      "Coaches"],
  ["/admins",       "Admins"],
  ["/wages",        "Wages"],
  ["/accounting",   "Accounting"],
  ["/history",      "Change History"],
];
const PLATFORM_ROUTES = [["/platform", "Platform"]];
const AUTH_ROUTES = [
  ["/login",           "SwimSync Admin"],
  ["/forgot-password", "Reset Password"],
  ["/reset-password",  "Set New Password"],
  ["/accept-invite",   "Welcome to SwimSync"],
];

// The seed class, for the two dynamic routes. Its NEXT lesson date, so the
// lesson page renders a real lesson rather than the "runs on Saturdays" notice.
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

// Errors are collected per route: cleared before each goto, read after settle.
let errors = [];
function watch(page) {
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
}

async function visit(page, route, expectedH1) {
  errors = [];
  await page.goto(`${ADMIN}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const h1 = await page.locator("h1").first().textContent({ timeout: 5000 }).catch(() => null);
  const seen = (h1 ?? "").trim();
  const name = route.slice(1).replace(/\//g, "_");
  await page.screenshot({ path: `${OUT}/smoke-admin-${name}.png`, fullPage: true });
  check(seen === expectedH1, `${route} renders "${expectedH1}"`,
    seen ? `h1 was "${seen}"` : `no <h1> on ${page.url()}`);
  check(errors.length === 0, `${route} loaded with no page/console error`,
    errors.slice(0, 3).join(" | "));
}

const { browser, ctx, page } = await launch({ headless: true });
watch(page);

try {
  const svc = createClient(API_URL, serviceKey());
  const { data: cls, error } = await svc
    .from("classes").select("id, day_of_week").eq("title", "Saturday Beginners").single();
  if (error || !cls) throw new Error(`seed class not found: ${error?.message}`);
  const lessonDate = nextDateFor(cls.day_of_week);

  console.log("\n[tenant admin] every business page");
  await loginAdmin(page, "coach@swimsync.test");
  for (const [route, h1] of TENANT_ROUTES) await visit(page, route, h1);
  // Both detail pages title themselves after the class once it loads ("Lesson"
  // / "Assess class" are their loading states), so the exact match here also
  // proves the class row resolved — first run read "Lesson" as the heading and
  // the exact-match rule caught it.
  await visit(page, `/lessons/${cls.id}/${lessonDate}`, "Saturday Beginners");
  await visit(page, `/assessment/${cls.id}`, "Saturday Beginners");

  console.log("\n[platform admin] the cross-tenant page");
  await page.evaluate(() => localStorage.clear());
  await ctx.clearCookies();
  await loginAdmin(page, "superadmin@swimsync.test");
  for (const [route, h1] of PLATFORM_ROUTES) await visit(page, route, h1);

  console.log("\n[logged out] the auth pages");
  await page.evaluate(() => localStorage.clear());
  await ctx.clearCookies();
  for (const [route, h1] of AUTH_ROUTES) await visit(page, route, h1);

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: `${OUT}/smoke-admin-error.png` });
  process.exitCode = 1;
} finally {
  await browser.close();
}
