// Trial / provisional student onboarding, end to end through the real UIs.
//
// THE LOAD-BEARING ASSERTION IS THE REFUSAL. Everything else here is plumbing;
// what actually matters is that a billable lesson with no parent account HOLDS
// THE MONTH OPEN, and that the admin is told which child and can resolve it
// without leaving the screen. If the month sealed instead, those lessons would
// be unbillable forever the moment the parent finally registered — the same
// permanent-underbill shape as §7.8, §7.13 and §7.32.
//
// It also pins the roster-union regression (RISK 6): a trial walk-in's
// enrolment is CLOSED on its own date, so before the union fix they vanished
// from the very screen that had just marked them.
//
// Setup: supabase running + seed; cd SwimSyncAdmin && npm run dev;
//        cd SwimSyncApp && npx expo start --web
//        supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt
import os from "node:os";
import path from "node:path";
import { launch, loginExpo, loginAdmin, tap, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (name) => path.join(SHOT, name);
const results = [];
const check = (label, pass, detail = "") => {
  results.push({ pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const STAMP = Date.now();
const WALK_IN = `Walkin ${STAMP}`;
// Placed by fixtures-trial-onboarding.sql in the PREVIOUS (billable) month.
// The UI-added walk-in above lands on TODAY, which generation correctly refuses
// to bill — a month must have ENDED (PRD §5.5) — so the billing assertions need
// a lesson that is actually in scope.
const FIXTURE_WALK_IN = "Fixture Walkin";

const { browser, page } = await launch();

// ── COACH: add a walk-in mid-lesson ──────────────────────────────────────────
await loginExpo(page, "coach@swimsync.test");
await page.waitForTimeout(1500);

// Reach a class roster, then the mark-attendance screen.
await tap(page.getByText(/Classes/i).first(), "Classes tab");
await page.waitForTimeout(1200);
await tap(page.getByText(/Saturday Beginners/i).first(), "the seed class");
await page.waitForTimeout(1200);
await tap(page.getByText(/Mark Attendance|Take Attendance/i).first(), "mark attendance");
await page.waitForTimeout(1500);

const beforeText = await page.evaluate(() => document.body.innerText);
check(
  "the Add a walk-in control is offered on the attendance screen",
  /Add a walk-in/i.test(beforeText)
);

await tap(page.getByText(/Add a walk-in/i).first(), "open the walk-in form");
await page.waitForTimeout(600);

await page.getByPlaceholder("Child's name").fill(WALK_IN);
await page.getByPlaceholder("Parent's phone (optional)").fill("+65 9123 4567");
await tap(page.getByText(/^Paid trial$/i).first(), "paid trial");
await page.waitForTimeout(300);
await tap(page.getByText(/Add & mark/i).first(), "submit the walk-in");
await page.waitForTimeout(2500);

const afterAdd = await page.evaluate(() => document.body.innerText);
check("the walk-in appears on the roster after being added", afterAdd.includes(WALK_IN));

// ⚠ RISK 6. Their enrolment was closed on this date, so a roster built from
// is_active enrolments alone would have lost them here. Reload — do not trust
// the in-memory state that added them.
await page.reload();
await page.waitForTimeout(2500);
const afterReload = await page.evaluate(() => document.body.innerText);
check(
  "RISK 6: the walk-in SURVIVES a reload of the attendance screen",
  afterReload.includes(WALK_IN),
  "closed trial enrolment must not hide them from the screen that marked them"
);
check(
  "and they are labelled so they don't read as a weekly regular",
  /Not enrolled/i.test(afterReload)
);
await page.screenshot({ path: shot("trial-01-coach-roster.png"), fullPage: true });

// ── ADMIN: the child shows as having no parent account ───────────────────────
// The TENANT admin, not superadmin@. The seed's platform admin belongs to no
// business, and PRD §4.4 deliberately closes every single-business page to
// them — /students would render an explanation and no rows. The seed coach is
// their own tenant's admin (the private-coach shape), which is the production
// arrangement too.
await loginAdmin(page, "coach@swimsync.test");
await page.goto(`${ADMIN}/students`);
await page.waitForTimeout(2000);

const studentsText = await page.evaluate(() => document.body.innerText);
check("the walk-in is listed on the admin Students page", studentsText.includes(WALK_IN));
check(
  "and is flagged as having no parent account",
  /No parent account/i.test(studentsText)
);
check(
  "the unclaimed filter is offered with a count",
  /No parent account \(\d+\)/.test(studentsText)
);
await page.screenshot({ path: shot("trial-02-admin-students.png"), fullPage: true });

// ── ADMIN: generation reports them and does NOT seal ─────────────────────────
await page.goto(`${ADMIN}/invoices`);
await page.waitForTimeout(2000);

// The month picker defaults to the last COMPLETED month (§7.32), which is the
// month we want: the walk-in was marked today, so use whatever the engine will
// accept and assert on the reported shape rather than a hardcoded month.
await tap(page.getByRole("button", { name: /Generate Invoices/i }).first(), "generate");
await page.waitForTimeout(1500);

// Pre-flight dialog → confirm.
const confirmBtn = page.getByRole("button", { name: /Generate|Confirm/i }).last();
if (await confirmBtn.count()) {
  await tap(confirmBtn, "confirm generation");
  await page.waitForTimeout(4000);
}

const genText = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: shot("trial-03-admin-generate.png"), fullPage: true });

// The whole point. Either the modal named them, or the result line did.
const named = genText.includes(FIXTURE_WALK_IN);
const explained = /no parent account to bill|have no parent account/i.test(genText);
check(
  "RISK 5: generation reports the unclaimed child BY NAME",
  named,
  named ? "" : "the admin cannot act on a number"
);
check(
  "and explains it as a missing parent account, not unmarked attendance",
  explained,
  "reporting 'attendance still unmarked' would send them hunting for a lesson that does not exist"
);
check(
  "the settle actions are offered INLINE in the same dialog",
  /Paid outside SwimSync/i.test(genText) && /Write off/i.test(genText),
  "a link to another page is a trip the admin does not make"
);
check(
  "the month is NOT reported as complete/closed",
  !/complete and now closed/i.test(genText),
  "sealing here would strand the lessons permanently"
);

// ── ADMIN: settling unblocks it ──────────────────────────────────────────────
if (/Paid outside SwimSync/i.test(genText)) {
  // The amount is REQUIRED — student_settlements CHECKs that a paid_outside row
  // carries one, so "money arrived" can never be recorded without saying how
  // much. Asserting the button is disabled until then pins that.
  const payBtn = page.getByRole("button", { name: /Paid outside SwimSync/i }).first();
  check(
    "Paid outside SwimSync is disabled until an amount is entered",
    await payBtn.isDisabled(),
    "an unpriced settlement is exactly what the DB CHECK refuses"
  );

  await page.getByLabel(/Amount received for/i).first().fill("30");
  await page.waitForTimeout(300);
  await tap(payBtn, "record the money as settled");
  await page.waitForTimeout(2500);
  const settledText = await page.evaluate(() => document.body.innerText);
  check(
    "settling is confirmed and prompts a re-run",
    /Recorded for|Generate again/i.test(settledText)
  );
  await page.screenshot({ path: shot("trial-04-settled.png"), fullPage: true });
}

await browser.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
