// Drives the phase-3 join-code flow end to end, across both apps.
//
//   admin  → the tenant admin can see their join code
//   parent → registers, is BLOCKED from adding a child, redeems the code,
//            then adds a child that lands in the right tenant
//
// This is the flow that replaces "parent self-registers and the admin finds
// them", so the blocked state matters as much as the happy path: a parent who
// can fill in the form and fail on save is worse than one who is told up front.
//
// Prereqs: supabase start · db reset · admin on :3000 · expo web on :8081.
import { launch, loginAdmin, loginExpo, tap, ADMIN, EXPO } from "./lib.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const EMAIL = `join-${Date.now()}@test.local`;
let joinCode = null;

// ── 1. Admin: read the join code off the dashboard ─────────────────────────
{
  const { browser, page } = await launch({ headless: true });
  try {
    await loginAdmin(page, "coach@swimsync.test", "password123");
    await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const body = await page.evaluate(() => document.body.innerText);

    const m = body.match(/SWIM-[A-Z0-9]{4,}/);
    joinCode = m ? m[0] : null;
    check("admin dashboard shows the parent join code", !!joinCode, joinCode ?? "not found");
    check(
      "dashboard is titled with the business name",
      body.includes("Coach Marcus Swim School")
    );
  } catch (e) {
    check("admin step completed", false, String(e));
  } finally {
    await browser.close();
  }
}

// ── 2. Parent: register, hit the gate, join, then add a child ──────────────
{
  const { browser, page } = await launch({ mobile: true, headless: true });
  try {
    // Register a fresh parent through the real UI.
    // A direct goto to /register (or /(auth)/register) BOUNCES to /login — the
    // route guard runs before the store rehydrates. Navigate in-app via the
    // "Register" link instead, which is what a real user does anyway.
    //
    // "Create Account" is BOTH the heading and the button, so .last() picks the
    // button — the same collision the skill records for "Sign In".
    await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);
    await tap(page.getByText("Register").last(), "register link");
    await page.waitForTimeout(5000);
    // The LOGIN screen stays mounted underneath (gotcha §7.10), so its email
    // and password inputs are still in the DOM. Everything here targets the
    // LAST match — the register screen, pushed on top.
    await page.getByPlaceholder("Sarah Tan").last().fill("Join Test Parent");
    await page.getByPlaceholder("you@email.com").last().fill(EMAIL);
    await page.getByPlaceholder("+65 9123 4567").last().fill("+65 91234567");
    const pw = page.locator('input[type="password"]');
    const n = await pw.count();
    await pw.nth(n - 2).fill("password123"); // password
    await pw.nth(n - 1).fill("password123"); // confirm
    await page.getByText("Create Account").last().click({ force: true });
    await page.waitForTimeout(8000);
    check("parent registered", !page.url().includes("/register"), page.url());

    // IN-APP navigation only. A direct goto to a protected route bounces to
    // /login before the store rehydrates (same reason the register route did).
    await tap(page.getByText("Add Child").last(), "add child");
    await page.waitForTimeout(5000);
    let body = await page.evaluate(() => document.body.innerText);
    check(
      "add-child is gated before joining a business",
      body.includes("Join your coach first"),
      ""
    );

    // Redeem the code — reached from the gate's own button.
    await tap(page.getByText("Enter a join code").last(), "enter a join code");
    await page.waitForTimeout(5000);
    await page.getByPlaceholder("SWIM-1234").last().fill(joinCode.toLowerCase()); // case tolerance
    // EXACT match: a plain "Join" also hits "Join Test Parent" on the screen
    // still mounted underneath, and "Join your coach" on this one.
    await tap(page.getByText("Join", { exact: true }).last(), "join button");
    await page.waitForTimeout(4000);

    // router.back() from the join screen lands on add-child, which reloads its
    // joined tenants on focus — that refresh is the thing being verified here.
    await page.waitForTimeout(3000);
    body = await page.evaluate(() => document.body.innerText);
    check(
      "after joining, add-child shows the business",
      body.includes("Coach Marcus Swim School"),
      ""
    );
    check(
      "the gate is gone",
      !body.includes("Join your coach first")
    );

    await page.getByPlaceholder("Emma Tan").last().fill("Join Test Kid");
    await page.getByPlaceholder("YYYY-MM-DD").last().fill("2018-04-01");
    await tap(page.getByText("Save Child Profile"), "save");
    await page.waitForTimeout(4000);
    body = await page.evaluate(() => document.body.innerText);
    check(
      "child saved (no error toast)",
      !body.toLowerCase().includes("failed to create"),
      ""
    );
  } catch (e) {
    check("parent step completed", false, String(e));
  } finally {
    await browser.close();
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
