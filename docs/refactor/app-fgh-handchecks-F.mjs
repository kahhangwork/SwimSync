// Hand-checks for App L-F (docs/refactor/BATCH_FGH_PLAN.md, ⚠ R5): the two parent Home
// writes NO verify-* driver reaches.
//   A. dismiss a DECLINED claim (dismiss_student_claim) — the card goes, and stays gone
//      after a reload.
//   B. register WITH a join code, then the first Home load applies it ONCE: the
//      "Joined …" Toast, parents.signup_join_code cleared, the parent_tenants row made.
// Run from .claude/skills/run-ui-playwright/drivers/ (copy it there) after a db reset +
// fixtures-payment-collection.sql. SHOTDIR / TAG name the screenshots. Every fixture
// write THROWS on error (§7.251) — a silent seed would make a check vacuously green.
import { launch, loginExpo, EXPO } from "./lib.mjs";
import { execSync } from "node:child_process";

const SHOT = process.env.SHOTDIR ?? "/tmp";
const TAG = process.env.TAG ?? "hc";
const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"`)
    .toString()
    .trim();
const res = [];
const check = (ok, msg) => res.push(`${ok ? "PASS" : "FAIL"} ${msg}`);

// ── A. a declined claim on the fixture parent ─────────────────────────────
const CLAIM = "da100000-0000-0000-0000-00000000c1a1";
psql(
  `INSERT INTO student_claims (id, tenant_id, student_id, parent_id, claimed_name, certainty, match_reason, status, decided_at)
   SELECT '${CLAIM}', 'da100000-0000-0000-0000-000000000001', 'da100000-0000-0000-0000-0000000000d1', p.id,
          'Zed Claimed', 'confirmed', 'name_only', 'declined', now()
     FROM parents p WHERE p.profile_id = 'da100000-0000-0000-0000-0000000000b1'`
);
check(psql(`SELECT count(*) FROM student_claims WHERE id = '${CLAIM}'`) === "1", "fixture: the declined claim exists");
{
  const { browser, page } = await launch();
  await loginExpo(page, "pay-driver-parent@swimsync.test");
  const notice = page.getByText(/Your coach checked/).first();
  await notice.waitFor({ timeout: 20000 });
  check(true, "Home shows the declined-claim notice");
  await page.screenshot({ path: `${SHOT}/hcF-${TAG}-A1-notice.png` });
  // The ✕ is the only pressable in the notice's header row.
  const row = notice.locator("xpath=ancestor::div[2]");
  await row.locator('[tabindex="0"]').last().click();
  await page.waitForTimeout(2500);
  check((await page.getByText(/Your coach checked/).count()) === 0, "the notice is gone at once (optimistic)");
  check(
    psql(`SELECT dismissed_at IS NOT NULL FROM student_claims WHERE id = '${CLAIM}'`) === "t",
    "student_claims.dismissed_at is set (dismiss_student_claim ran)"
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Welcome back,").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  check((await page.getByText(/Your coach checked/).count()) === 0, "…and stays gone after a reload");
  await page.screenshot({ path: `${SHOT}/hcF-${TAG}-A2-dismissed.png` });
  await browser.close();
}

// ── B. register with a join code → the first Home load applies it ─────────
const EMAIL = `hcf-${Date.now()}@swimsync.test`;
{
  const { browser, page } = await launch();
  // Reached by TAPPING Register on /login, as the drivers do — a deep link leaves the
  // login screen mounted underneath (§7.254), so scope every field to the LAST match.
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.getByText("Register", { exact: true }).last().waitFor({ timeout: 45000 });
  await page.getByText("Register", { exact: true }).last().click();
  await page.getByPlaceholder("Sarah Tan").last().waitFor({ timeout: 30000 });
  await page.getByPlaceholder("Sarah Tan").last().fill("Hand Check");
  await page.getByPlaceholder("you@email.com").last().fill(EMAIL);
  await page.getByPlaceholder("+65 9123 4567").last().fill("91234567");
  await page.getByPlaceholder("SWIM-1234 or REF-ABCDE").last().fill("SWIM-TEST");
  const pw = page.locator('input[type="password"]');
  const n = await pw.count();
  await pw.nth(n - 2).fill("password123");
  await pw.nth(n - 1).fill("password123");
  await page.getByText("Create Account").last().click();
  const toast = page.getByText(/Joined Coach Marcus Swim School/).first();
  let toasted = false;
  try {
    await toast.waitFor({ timeout: 30000 });
    toasted = true;
  } catch {}
  await page.screenshot({ path: `${SHOT}/hcF-${TAG}-B-joined.png` });
  check(new URL(page.url()).pathname.endsWith("/home"), `registered and landed on /home (${page.url()})`);
  check(toasted, 'the "Joined Coach Marcus Swim School." Toast showed on the first Home load');
  await page.waitForTimeout(2000);
  const pid = psql(`SELECT p.id FROM parents p JOIN profiles pr ON pr.id = p.profile_id JOIN auth.users u ON u.id = pr.id WHERE u.email = '${EMAIL}'`);
  check(pid.length > 0, "the parent row exists");
  check(psql(`SELECT coalesce(signup_join_code, '<null>') FROM parents WHERE id = '${pid}'`) === "<null>", "parents.signup_join_code is cleared");
  check(
    psql(`SELECT count(*) FROM parent_tenants WHERE parent_id = '${pid}' AND tenant_id = '70000000-0000-0000-0000-000000000001'`) === "1",
    "the parent_tenants row for Coach Marcus exists (joined exactly once)"
  );
  await browser.close();
}

console.log(res.join("\n"));
console.log(`${res.filter((r) => r.startsWith("PASS")).length}/${res.length} hand-checks passed`);
process.exit(res.every((r) => r.startsWith("PASS")) ? 0 : 1);
