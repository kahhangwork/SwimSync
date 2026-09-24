// verify-app-home-writes.mjs — the two parent Home writes no other driver reaches.
//
// WHY THIS EXISTS. Promoted from the App L-F hand-check
// (docs/refactor/app-fgh-handchecks-F.mjs), proven on the pre-refactor AND the
// refactored Home. A regression in either write was invisible until a parent
// reported it:
//   A. Dismiss a DECLINED claim (dismiss_student_claim) — the card goes at once,
//      the row is stamped, and it stays gone after a reload.
//   B. Register WITH a join code, then the first Home load applies it ONCE
//      (useSignupJoinCode): the "Joined …" Toast, parents.signup_join_code
//      cleared, exactly one parent_tenants row for the business.
//
// Setup:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-app-home-writes.sql
//   Expo web on :8081 (or EXPO_URL).
//
// Personas (all password123):
//   app-home-parent@swimsync.test     fixture parent holding the declined claim
//   app-home-register@swimsync.test   registered through the UI by check B, with
//                                     the SEED join code SWIM-TEST (the fixture
//                                     and teardown both remove it)

import os from "node:os";
import { execSync } from "node:child_process";
import { launch, loginExpo, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/app-home-writes-${n}.png`;
const MARCUS = "70000000-0000-0000-0000-000000000001";
const CLAIM = "ac200000-0000-0000-0000-00000000c1a1";
const REGISTER = "app-home-register@swimsync.test";

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"`)
    .toString()
    .trim();

// Preconditions: a vacuous pass on a half-loaded fixture is worse than a loud stop.
const pre = psql(
  `SELECT (SELECT count(*) FROM student_claims WHERE id = '${CLAIM}' AND status = 'declined' AND dismissed_at IS NULL)
     || '|' || (SELECT count(*) FROM auth.users WHERE email = '${REGISTER}')`
);
if (pre !== "1|0") {
  console.error(`✗ fixture not in its starting state (claim|registered = ${pre}, want 1|0) — load fixtures-app-home-writes.sql`);
  process.exit(1);
}

const browsers = [];
try {
  // ── A. dismiss the declined claim ─────────────────────────────────────────
  {
    const { browser, page } = await launch();
    browsers.push(browser);
    await loginExpo(page, "app-home-parent@swimsync.test");
    const notice = page.getByText(/Your coach checked/).first();
    check("A: Home shows the declined-claim notice", await notice.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
    await page.screenshot({ path: shot("A1-notice") });
    // The ✕ is the only pressable in the notice's header row.
    const row = notice.locator("xpath=ancestor::div[2]");
    await row.locator('[tabindex="0"]').last().click();
    await page.waitForTimeout(2500);
    check("A: the notice is gone at once (optimistic)", (await page.getByText(/Your coach checked/).count()) === 0);
    check(
      "A: student_claims.dismissed_at is set (dismiss_student_claim ran)",
      psql(`SELECT dismissed_at IS NOT NULL FROM student_claims WHERE id = '${CLAIM}'`) === "t"
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Welcome back,").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(3000);
    check("A: …and stays gone after a reload", (await page.getByText(/Your coach checked/).count()) === 0);
    await page.screenshot({ path: shot("A2-dismissed") });
    await browser.close();
  }

  // ── B. register with a join code → the first Home load applies it ─────────
  {
    const { browser, page } = await launch();
    browsers.push(browser);
    // Reached by TAPPING Register on /login — a deep link leaves the login screen
    // mounted underneath (§7.254), so every field is scoped to the LAST match.
    await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
    await page.getByText("Register", { exact: true }).last().waitFor({ timeout: 45000 });
    await page.getByText("Register", { exact: true }).last().click();
    await page.getByPlaceholder("Sarah Tan").last().waitFor({ timeout: 30000 });
    await page.getByPlaceholder("Sarah Tan").last().fill("Home Register");
    await page.getByPlaceholder("you@email.com").last().fill(REGISTER);
    await page.getByPlaceholder("+65 9123 4567").last().fill("90002222");
    await page.getByPlaceholder("SWIM-1234 or REF-ABCDE").last().fill("SWIM-TEST");
    const pw = page.locator('input[type="password"]');
    const n = await pw.count();
    await pw.nth(n - 2).fill("password123");
    await pw.nth(n - 1).fill("password123");
    await page.getByText("Create Account").last().click();
    const toasted = await page
      .getByText(/Joined Coach Marcus Swim School/)
      .first()
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    await page.screenshot({ path: shot("B-joined") });
    check("B: registered and landed on /home", new URL(page.url()).pathname.endsWith("/home"), page.url());
    check('B: the "Joined Coach Marcus Swim School." Toast showed on the first Home load', toasted);
    await page.waitForTimeout(2000);
    const pid = psql(
      `SELECT p.id FROM parents p JOIN auth.users u ON u.id = p.profile_id WHERE u.email = '${REGISTER}'`
    );
    check("B: the parent row exists", pid.length > 0);
    if (pid) {
      check(
        "B: parents.signup_join_code is cleared",
        psql(`SELECT coalesce(signup_join_code, '<null>') FROM parents WHERE id = '${pid}'`) === "<null>"
      );
      check(
        "B: exactly one parent_tenants row for Coach Marcus (joined once)",
        psql(`SELECT count(*) FROM parent_tenants WHERE parent_id = '${pid}' AND tenant_id = '${MARCUS}'`) === "1"
      );
    }
    // Applied ONCE: a second Home load must neither re-toast nor re-join.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Welcome back,").first().waitFor({ timeout: 30000 }).catch(() => {});
    const again = await page
      .getByText(/Joined Coach Marcus Swim School/)
      .first()
      .waitFor({ timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    check("B: a second Home load does NOT toast the join again", !again);
    await browser.close();
  }
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
