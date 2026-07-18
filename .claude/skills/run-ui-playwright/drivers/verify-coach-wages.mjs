// Phase 5: coach wages, admin → coach, through both real UIs.
//
// The seed coach is a PRIVATE coach (tenant_admin who also teaches), so they
// are both the payer and the payee here — which is exactly the shape that
// exercises "a wage exists when a coach has a rate", with no private-vs-school
// branch anywhere.
//
// Prereqs: supabase start · db reset · admin :3000 · expo web :8081.
import { launch, loginAdmin, ADMIN, EXPO, tap } from "./lib.mjs";
import { execSync } from "node:child_process";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// Piped on stdin, not passed with -c: psql's -c does not accept the embedded
// newlines of a multi-statement script and fails with "invalid command \\n".
const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -t -A`, {
    encoding: "utf8",
    shell: "/bin/bash",
    input: sql,
  }).trim();

// Two taught lessons in June 2026: one attended (pays), one all-absent (does not).
psql(`
INSERT INTO students (id, full_name, assignment_status, tenant_id)
VALUES ('11110000-0000-0000-0000-000000000001','Wage Driver Kid','assigned',
        (SELECT id FROM tenants WHERE slug='marcus-swim'));
INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('11110000-0000-0000-0000-000000000001',(SELECT id FROM classes LIMIT 1), TRUE);
INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
 ('22220000-0000-0000-0000-000000000001',(SELECT id FROM classes LIMIT 1),'2026-06-06','completed'),
 ('22220000-0000-0000-0000-000000000002',(SELECT id FROM classes LIMIT 1),'2026-06-13','completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
 ('22220000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','present','c0000000-0000-0000-0000-000000000001'),
 ('22220000-0000-0000-0000-000000000002','11110000-0000-0000-0000-000000000001','absent','c0000000-0000-0000-0000-000000000001');
`);

{
  const { browser, page } = await launch({ headless: true });
  try {
    await loginAdmin(page, "coach@swimsync.test", "password123");
    await page.goto(`${ADMIN}/wages`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    let body = await page.evaluate(() => document.body.innerText);

    check("wages page renders", body.includes("Coach Wages"), "");
    check(
      "a coach with no rate is shown as not on payroll",
      body.includes("Not on payroll"),
      ""
    );

    // Set a rate: $40 per 60 min from Jan 2026. The seed class is 10:00–11:00.
    await tap(page.getByText(/Set a rate|Change rate/).first(), "set a rate");
    await page.waitForTimeout(800);
    // Target the RATE amount by its placeholder: the policy card above has a
    // number input (wage_run_day) that comes first in the DOM, and .first()
    // silently filled that instead.
    await page.getByPlaceholder("30.00").fill("40");
    await page.locator('input[type="date"]').first().fill("2026-01-01");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(2000);

    body = await page.evaluate(() => document.body.innerText);
    check("rate saved and shown", body.includes("40.00"), "");

    // Run payroll for June 2026.
    await page.locator('input[type="month"]').fill("2026-06");
    await page.getByRole("button", { name: /Calculate payroll/ }).click();
    await page.waitForTimeout(3000);
    body = await page.evaluate(() => document.body.innerText);

    // One paying lesson at 60 min × $40/60min = $40.00. The all-absent lesson
    // must NOT contribute — that is the decision rule, visible in the total.
    check(
      "payroll pays only the attended lesson (S$40.00, not S$80.00)",
      body.includes("40.00") && !body.includes("80.00"),
      ""
    );
    check("payout starts as a Draft", body.includes("Draft"), "");

    // Freeze it.
    await page.getByText("Mark paid").first().click();
    await page.waitForTimeout(2500);
    body = await page.evaluate(() => document.body.innerText);
    check("marked paid and frozen", body.includes("Frozen"), "");
  } catch (e) {
    check("admin step completed", false, String(e));
  } finally {
    await browser.close();
  }
}

// The database is what matters, not the toast.
const frozen = psql(
  `SELECT status || '|' || gross_amount FROM coach_payouts WHERE period_month='2026-06';`
);
check("payout is paid in the database", frozen.startsWith("paid|40"), frozen);

// A correction to the FROZEN month must not rewrite it.
psql(`UPDATE attendance SET status='present' WHERE lesson_session_id='22220000-0000-0000-0000-000000000002';`);
psql(`SELECT * FROM set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}',false);`);
const stillFrozen = psql(
  `SELECT gross_amount FROM coach_payouts WHERE period_month='2026-06';`
);
check(
  "a later correction does not rewrite the paid month",
  stillFrozen.startsWith("40"),
  stillFrozen
);

// ── The coach sees their own pay in the mobile app ─────────────────────────
{
  const { browser, page } = await launch({ mobile: true, headless: true });
  try {
    await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);
    await page.getByPlaceholder("you@email.com").last().fill("coach@swimsync.test");
    await page.locator('input[type="password"]').last().fill("password123");
    await page.getByText("Sign In").last().click({ force: true });
    await page.waitForTimeout(8000);

    await tap(page.getByText("Billing").last(), "billing tab");
    await page.waitForTimeout(6000);
    const body = await page.evaluate(() => document.body.innerText);
    check("coach sees a 'Your pay' section", body.includes("Your pay"), "");
    check("coach sees their own payout amount", body.includes("40.00"), "");
  } catch (e) {
    check("coach step completed", false, String(e));
  } finally {
    await browser.close();
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
