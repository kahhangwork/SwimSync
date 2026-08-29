// A booked trial, seen from all three sides — parent, coach, admin.
//
// WHY THIS EXISTS. A trial is a BOOKING, not an enrolment, so a booked child
// sits at assignment_status = 'unassigned' with no enrolment row. Every screen
// that reads that field described them as "waiting to be placed in a class",
// which is false — and the admin's Unassigned page then offered Assign, which
// inserts an ACTIVE ENROLMENT and makes the child expected EVERY week. A child
// who tries one lesson and never returns would then silently block that
// class's month from being billed, because unmarked attendance stops
// generation outright with no override.
//
// THE LOAD-BEARING ASSERTIONS are the two that protect money and the one that
// answers the family's actual question:
//   • an upcoming trial is ABSENT from Unassigned Children (no prompt, no
//     accidental enrolment);
//   • a PAST trial is still PRESENT there (that is the real decision point —
//     did they convert? — and hiding it would lose the child entirely);
//   • the parent is told WHEN their trial is, which the app knew all along and
//     never said.
//
// Setup:
//   supabase db reset && docker restart supabase_kong_SwimSync
//   psql -f drivers/fixtures-trial-visibility.sql
//   SwimSyncAdmin npm run dev; SwimSyncApp npx expo start --web
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { launch, loginAdmin, loginExpo, tap, ADMIN } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (l, p, d = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
};

// Newlines are collapsed: JSON.stringify emits a literal \n, which psql parses
// as SQL rather than as whitespace and rejects.
const sql = (q) =>
  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -tAc ${JSON.stringify(
      q.replace(/\s+/g, " ").trim()
    )}`,
    { encoding: "utf8" }
  ).trim();

// ══ PARENT: "when is my trial?" ═══════════════════════════════════════════
const { browser, page } = await launch({ mobile: true });
await loginExpo(page, "trialvis-parent@swimsync.test");
await page.waitForTimeout(3000);

let text = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: shot("tv-01-parent.png"), fullPage: true });

check(
  "the parent is told their child has a TRIAL BOOKED",
  /Trial lesson booked/i.test(text),
  "before this the card said the admin would assign them soon — which was false"
);
// ⚠ NEVER HARDCODE THE MONTH HERE. The fixture books the strictly-NEXT
// Saturday in SGT, so in the last week of most months that Saturday falls in
// the NEXT month. This assertion read /\d{1,2}\s+Aug/ and went red on
// 2026-08-30 — a Sunday, whose next Saturday is 5 Sep. "August" was never the
// fact being tested; "whatever month the fixture landed in" was. So ASK THE
// DATABASE what it inserted rather than restating its date maths here: two
// copies of the same calculation is the thing that drifts (§7.225).
// The \w* is §8.90's ICU trap — 'Sep' and 'Sept' must both pass.
const [trialDay, trialMon] = sql(`
  SELECT to_char(session_date,'FMDD') || '|' || to_char(session_date,'Mon')
    FROM trial_bookings
   WHERE student_id = '7d099999-0000-0000-0000-000000000001'
   ORDER BY session_date DESC LIMIT 1`).split("|");

check(
  "...and WHEN, with the class named",
  /Saturday Beginners/i.test(text) &&
    new RegExp(`${trialDay}\\s+${trialMon}\\w*`, "i").test(text),
  `the only question a family actually has about a trial — expected "${trialDay} ${trialMon}"`
);
check(
  "the misleading 'will assign your child soon' is gone for that child",
  !/will assign your child soon/i.test(text),
  "their lesson is booked; nothing is pending"
);

// ══ COACH: "who is turning up?" ═══════════════════════════════════════════
const coach = await launch({ mobile: true });
await loginExpo(coach.page, "coach@swimsync.test");
await coach.page.waitForTimeout(2500);
await tap(coach.page.getByText("Classes").last(), "Classes tab");
await coach.page.waitForTimeout(3000);
// The class CARD is not the link — "View Roster & Sessions" is. Tapping the
// title left the driver sitting on the class list asserting against it.
await tap(
  coach.page.getByText(/View Roster & Sessions/i).first(),
  "open the roster"
);
await coach.page.waitForTimeout(4500);

text = await coach.page.evaluate(() => document.body.innerText);
await coach.page.screenshot({ path: shot("tv-02-coach.png"), fullPage: true });

check(
  "the coach sees a 'Trials coming up' panel",
  /Trials? coming up/i.test(text),
  "both coach screens already queried trial_bookings — nothing was ever rendered"
);
check(
  "...naming the guest and the date",
  /Trialvis Guest/i.test(text) && /\d{1,2}\s+Aug/i.test(text)
);
check(
  "the guest is NOT listed among the enrolled students",
  !/Students \(\d+\)[\s\S]{0,400}Trialvis Guest/i.test(text),
  "a guest for one lesson must not read as a weekly student"
);

// ══ ADMIN: who actually needs a decision ══════════════════════════════════
const admin = await launch();
await loginAdmin(admin.page, "coach@swimsync.test");
await admin.page.goto(`${ADMIN}/unassigned`);
await admin.page.waitForTimeout(2500);

text = await admin.page.evaluate(() => document.body.innerText);
await admin.page.screenshot({ path: shot("tv-03-unassigned.png"), fullPage: true });

check(
  "⚠ a child with an UPCOMING trial is NOT offered for assignment",
  !/Trialvis Mine/i.test(text) && !/Trialvis Guest/i.test(text),
  "Assign inserts an ACTIVE ENROLMENT — expected every week, blocks invoicing"
);
check(
  "⚠ a child whose trial has PASSED is still listed",
  /Trialvis Pasttrial/i.test(text),
  "that is the real decision point: did they convert?"
);
check(
  "a child with no trial at all is unaffected",
  /Trialvis Plain/i.test(text),
  "the control — this page must not start hiding ordinary children"
);

// ══ THE GUARD: a stale page still holding the old list ════════════════════
// The filter above makes this unreachable from a fresh load, which is exactly
// why the guard exists: a page opened BEFORE the trial was booked still offers
// Assign, and the cost of being wrong is a blocked billing month.
const before = sql("SELECT count(*) FROM student_class_enrolments");

sql(`INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
     SELECT '70000000-0000-0000-0000-000000000001','7d099999-0000-0000-0000-000000000004',
            c.id, (now() AT TIME ZONE 'Asia/Singapore')::date
                  + (6 - EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int + 7) % 7
                  + CASE WHEN EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int = 6 THEN 7 ELSE 0 END,
            c.category_id,'c0000000-0000-0000-0000-000000000001'
       FROM classes c WHERE c.title = 'Saturday Beginners'
        AND c.tenant_id = '70000000-0000-0000-0000-000000000001'`);
console.log("booked a trial for Trialvis Plain WITHOUT reloading the admin page");

await tap(
  admin.page.getByRole("button", { name: /^Assign/i }).last(),
  "assign the now-booked child from the stale list"
);
await admin.page.waitForTimeout(700);
const selects = admin.page.locator("select");
if ((await selects.count()) > 0) {
  await selects.nth(0).selectOption({ index: 1 });
  await admin.page.waitForTimeout(500);
  if ((await selects.count()) > 1) {
    await selects.nth(1).selectOption({ index: 1 });
  }
}
await admin.page.waitForTimeout(400);
// "Confirm Assignment", NOT "Assign" — the row button is also called Assign,
// so /^Assign$/ re-hit the row and closed the modal, leaving the driver
// asserting against the list it started from.
await tap(
  admin.page.getByRole("button", { name: /Confirm Assignment/i }).first(),
  "confirm assign (first press)"
);
await admin.page.waitForTimeout(2500);

text = await admin.page.evaluate(() => document.body.innerText);
await admin.page.screenshot({ path: shot("tv-04-guard.png"), fullPage: true });

check(
  "⚠ the guard REFUSES the first press and explains the consequence",
  /already has a trial booked/i.test(text) && /every week/i.test(text),
  "a page loaded before the booking still offers the harmful action"
);
check(
  "⚠ and NOTHING was enrolled",
  sql("SELECT count(*) FROM student_class_enrolments") === before,
  "a guard that warns after writing is not a guard"
);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
await browser.close();
await coach.browser.close();
await admin.browser.close();
process.exit(passed === results.length ? 0 : 1);
