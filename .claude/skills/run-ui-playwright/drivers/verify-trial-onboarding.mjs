// Trial / provisional student onboarding, end to end through the real UIs.
//
// THE LOAD-BEARING ASSERTION IS THE REFUSAL. Everything else here is plumbing;
// what actually matters is that a billable lesson with no parent account HOLDS
// THE MONTH OPEN, and that the admin is told which child and can resolve it
// without leaving the screen. If the month sealed instead, those lessons would
// be unbillable forever the moment the parent finally registered — the same
// permanent-underbill shape as §7.8, §7.13 and §7.32.
//
// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN 2026-08-01, AND THE REASON IS WORTH KNOWING.
//
// This driver used to open by adding a walk-in through the COACH's attendance
// screen. `912bd11` (2026-07-25 22:59) deleted that control when a trial became
// a booking the ADMIN arranges ahead of time (PRD §7.17) — two hours after this
// driver was written at 20:49 the same day. From then it FAILED its first check
// and then CRASHED on the tap, so it scored nothing and guarded nothing, and the
// six billing checks below — the ones that matter — were unreachable behind the
// crash. Nobody noticed for a week, because no driver runs in CI
// (`BACKLOG.md` → *Run the UI drivers in CI*).
//
// The fix was not to rebuild the deleted flow but to change the SUBJECT: every
// surviving assertion now points at `Fixture Walkin`, which
// fixtures-trial-onboarding.sql creates with the identical shape (a trial
// enrolment opened and closed on its own date, no parent link). The screens are
// reached by URL instead of by clicking through a creation form that no longer
// exists.
//
// Two checks were dropped rather than re-pointed, both deliberately:
//   • "the Add a walk-in control is offered" — the control is gone by design.
//   • "labelled so they don't read as a weekly regular" — MEASURED 2026-08-01:
//     the badge renders only when `attendedOnly` is true (lib/attendanceRoster.ts),
//     and the fixture's walk-in IS enrolled on its own date because the enrolment
//     span is both-ends-inclusive. So no badge renders for it and the assertion
//     has no subject here. Re-pointing it would mean giving the fixture a child
//     with attendance but no enrolment span — a different scenario, and not one
//     this driver is about.
//
// A NOTE ON WHAT THE ROSTER CHECK IS WORTH. "the trial walk-in is on the roster
// of the lesson that marked them" is defended in depth: they arrive either
// through the both-ends-inclusive enrolment span OR through the attendance
// union, so ONE of those regressing will not turn it red. It pins the
// user-visible guarantee — they never vanish from the screen that just marked
// them — rather than either mechanism, which is the right thing to assert but a
// weaker test than its history suggests. `lib/attendanceRoster.test.ts` pins the
// two mechanisms separately, and that is where a unit-level regression shows up.
//
// Setup: supabase running + seed; cd SwimSyncAdmin && npm run dev;
//        cd SwimSyncApp && npx expo start --web
//        supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt
//        docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//          < .claude/skills/run-ui-playwright/drivers/fixtures-trial-onboarding.sql
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { launch, loginExpo, loginAdmin, tap, gotoAuthed, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (name) => path.join(SHOT, name);
const results = [];
const check = (label, pass, detail = "") => {
  results.push({ pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Ask the database where the fixture put things. One source of truth. */
function sql(q) {
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc ${JSON.stringify(q)}`,
    { encoding: "utf8" }
  ).trim();
}

// The unclaimed child, and the lesson they were marked at. Both come from the
// fixture, which derives them from the clock — the billable month must have
// ENDED (PRD §5.5), so a hardcoded date would stop meaning anything next month.
const WALK_IN = "Fixture Walkin";
// ONE LINE EACH, deliberately: the query goes through `docker exec ... -c`, and
// an embedded newline arrives as a literal \n rather than whitespace, which
// Postgres rejects with `syntax error at or near "\"`. Same trap as
// verify-attendance-guard.mjs.
const FROM_WALKIN_LESSON = `FROM lesson_sessions ls JOIN attendance a ON a.lesson_session_id = ls.id JOIN students s ON s.id = a.student_id WHERE s.full_name = '${WALK_IN}'`;
const CLASS_ID = sql(`SELECT ls.class_id ${FROM_WALKIN_LESSON}`);
const LESSON_DATE = sql(`SELECT ls.session_date ${FROM_WALKIN_LESSON}`);

if (!CLASS_ID || !LESSON_DATE) {
  console.error(
    `\nDRIVER ABORTED: no lesson found for "${WALK_IN}".` +
      `\nLoad fixtures-trial-onboarding.sql first — without it every check below` +
      `\nwould pass or fail for reasons that have nothing to do with the product.`
  );
  process.exit(1);
}
console.log({ WALK_IN, CLASS_ID, LESSON_DATE });

const { browser, page } = await launch();

// ── COACH: the trial walk-in has not vanished from the lesson that marked them ─
// Their enrolment was opened AND closed on this date, so a roster built from
// is_active enrolments alone would lose them here — which is precisely what
// happened before the roster fix.
await loginExpo(page, "coach@swimsync.test");
await page.waitForTimeout(1500);
await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS_ID}/attendance?date=${LESSON_DATE}`);
await page.waitForTimeout(3500);

const rosterText = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: shot("trial-01-coach-roster.png"), fullPage: true });
check(
  "the trial walk-in is on the roster of the lesson that marked them",
  rosterText.includes(WALK_IN),
  rosterText.includes(WALK_IN)
    ? ""
    : "a closed trial enrolment must not hide them from the screen that marked them"
);

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
// month we want: the fixture's lesson is in it. Assert on the reported shape
// rather than a hardcoded month.
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
const named = genText.includes(WALK_IN);
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

// ── ADMIN: the Billing months card keeps the reason (BILLING_MONTHS_PLAN.md) ──
// The result line and modal above vanish on reload. The card is the record that
// does not: the month shows OPEN, names why, and reopens the same modal. The
// driver NEVER re-generates after settling (⚠ RISK 4): that would seal the seed
// tenant's month — Closed is covered by vitest and the Deno sealed-shape test.
const MONTH = LESSON_DATE.slice(0, 7);
check(
  "the engine RECORDED the run (billing_runs row for the month)",
  sql(`SELECT count(*) FROM billing_runs WHERE tenant_id = '70000000-0000-0000-0000-000000000001' AND billing_month = '${MONTH}' AND unclaimed_billable > 0`) === "1",
  "RISK 1 — a silent insert failure leaves the card with nothing to show"
);

await page.reload();
await page.waitForTimeout(2500);
const monthRow = page.getByTestId(`billing-month-${MONTH}`);
const rowText = (await monthRow.count()) ? await monthRow.innerText() : "";
check(
  "after a RELOAD, the card shows the month as Open",
  (await monthRow.count()) > 0 && (await monthRow.getAttribute("data-state")) === "open",
  rowText ? "" : "no row for the fixture month"
);
check(
  "…with the reason and when it was last run",
  /no parent to bill/i.test(rowText) && /as of last run/i.test(rowText),
  rowText
);
await page.screenshot({ path: shot("trial-03b-billing-months-card.png"), fullPage: true });

await tap(monthRow.getByRole("button", { name: /Unclaimed \(1\)/ }), "open Unclaimed from the card");
await page.waitForTimeout(1500);
const fromCard = await page.evaluate(() => document.body.innerText);
check(
  "the card's Unclaimed button reopens the modal naming the child (D4)",
  fromCard.includes(WALK_IN) && /Paid outside SwimSync/i.test(fromCard)
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

  // ⚠ RISK 6 in the UI: the stored run still lists the child, but they are now
  // settled — the card must not offer them for a second settlement.
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForTimeout(2500);
  const row2 = page.getByTestId(`billing-month-${MONTH}`);
  await tap(row2.getByRole("button", { name: /Unclaimed \(1\)/ }), "reopen Unclaimed after settling");
  await page.waitForTimeout(1500);
  const after = await row2.innerText();
  check(
    "RISK 6: a settled child is NOT offered again — the card says to refresh",
    /claimed or settled since the last run/i.test(after),
    after
  );
}

await browser.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
