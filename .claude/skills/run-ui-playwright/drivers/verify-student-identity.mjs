// Drives the student-identity + derived-age work (HANDOVER §8, PRD §5.1/§7.4).
//
// Why this exists rather than trusting the unit tests: ageFromDob is covered by
// 8 unit tests in each app, but the RENDER is where this family of bug lives.
// §7.28 — a column read off the wrong level of a nested select typechecks fine
// and shipped "every child renders as Inactive". Age arrives through exactly
// such a nested select on the coach roster, so it is read from the DOM here.
//
// Clock is pinned to 2026-07-19 so the expected ages are fixed. See the fixture.
//
// The last check adds a second "Maya Tan", so RE-SEED (or delete that row)
// before re-running, or the positive control has nothing left to prove:
//
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -c \
//     "DELETE FROM parent_students WHERE student_id IN (SELECT id FROM students
//      WHERE date_of_birth='2022-01-05');
//      DELETE FROM students WHERE date_of_birth='2022-01-05';"
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-student-identity.sql
//   node drivers/verify-student-identity.mjs
//
// Then confirm the write really landed — deliberately asserted HERE and not
// in-page, because an in-page fetch that falls back to "inconclusive" on
// error is a check that passes when nothing happened (§7.17):
//
//   psql -c "SELECT full_name, date_of_birth FROM students
//            WHERE full_name='Maya Tan' ORDER BY date_of_birth;"   -- 2 rows

import { launch, loginExpo, tap, EXPO } from "./lib.mjs";

const TODAY = "2026-07-19T10:00:00+08:00";
let pass = 0, fail = 0;
function check(ok, label, detail = "") {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
}

const { browser, page } = await launch({ mobile: true, headless: true });
await page.clock.install({ time: new Date(TODAY) });

try {
  // ── Coach roster: ages, and the two-Ethan-Tans disambiguation ────────────
  console.log("\n[coach] roster — derived age + duplicate-name disambiguation");
  await loginExpo(page, "coach@swimsync.test");
  await tap(page.getByText("Classes").last(), "Classes tab");
  await page.waitForTimeout(2000);
  // "Saturday Beginners" also appears in the Unmarked Lessons cards above, and
  // those are not links — tapping the title silently stays on the list. The
  // roster opens from this button only.
  await tap(page.getByText("View Roster & Sessions").first(), "View Roster");
  await page.waitForTimeout(3000);

  const roster = await page.evaluate(() => document.body.innerText);

  // Maya's birthday is TODAY — she must have aged, not be 5.
  check(/Maya Tan[\s\S]{0,40}Age 6/.test(roster),
    "a child whose birthday is TODAY shows the incremented age",
    roster.match(/Maya Tan[\s\S]{0,40}/)?.[0]);

  // The younger Ethan's birthday has NOT passed this year (Nov). A naive
  // year-subtraction renders 7; correct is 6.
  check(/Age 6/.test(roster) && /Age 8/.test(roster),
    "both Ethan Tans show their own age (8 and 6, not 8 and 7)");
  check(!/Age 7/.test(roster),
    "no child is off by one — 'Age 7' must not appear",
    roster.match(/Age 7[\s\S]{0,30}/)?.[0]);

  // The duplicate-name case: birthday shown ONLY for the colliding pair.
  const bornCount = (roster.match(/born /g) ?? []).length;
  check(bornCount === 2,
    "birthday shown for exactly the two same-named children",
    `found ${bornCount} 'born' labels`);
  check(!/Maya Tan[\s\S]{0,60}born/.test(roster),
    "a uniquely-named child is NOT cluttered with a birthday");

  // THE YEAR IS THE POINT. Two children of the same name are usually the same
  // day-and-month apart only by year, so "born 10 Mar" would render
  // identically for both — the disambiguator failing at its one job.
  check(/born 10 Mar 2018/.test(roster) && /born 2 Nov 2019/.test(roster),
    "the birthday includes the YEAR, which is what actually separates them",
    roster.match(/born [^\n]*/g)?.join(" | "));

  // A legacy row with no DOB shows no age line at all. "Age unknown" would be
  // a row of noise on every such student; it is reserved for the case where it
  // is actually actionable — see the ambiguous branch below.
  check(/Noah Lim\nRemove/.test(roster) || !/Noah Lim[\s\S]{0,25}Age/.test(roster),
    "a child with no DOB shows no age line rather than a filler one",
    roster.match(/Noah Lim[\s\S]{0,40}/)?.[0]);
  check(!/Age 0\b/.test(roster),
    "'Age 0' never appears — null is never coerced to zero");

  // ── Parent child detail ─────────────────────────────────────────────────
  console.log("\n[parent] child detail — age row");
  // Supabase keeps the session in localStorage, so logging in as a second user
  // needs it cleared first — otherwise /login redirects straight back to the
  // coach's tabs and the next fill() times out on a field that isn't there.
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await loginExpo(page, "identity@test.local");
  await page.waitForTimeout(2000);
  await tap(page.getByText("Maya Tan").first(), "Maya Tan");
  await page.waitForTimeout(3000);

  const detail = await page.evaluate(() => document.body.innerText);
  // Assert on a string unique to THIS screen — §7.10: the previous screen
  // stays mounted underneath, so innerText contains both.
  check(/Date of Birth/.test(detail), "on the child detail screen");
  check(/Age[\s\S]{0,20}6 years old/.test(detail),
    "age renders as a labelled row derived from DOB",
    detail.match(/Age[\s\S]{0,30}/)?.[0]);

  // ── Re-registering the same child reads as English, not as a 23505 ───────
  console.log("\n[parent] add-child — the duplicate is explained, not dumped");
  await page.goBack();
  await page.waitForTimeout(2000);
  await tap(page.getByText("Add Child").last(), "Add Child");
  await page.waitForTimeout(2500);
  await page.getByPlaceholder("Emma Tan").fill("Maya Tan");
  await page.getByPlaceholder("YYYY-MM-DD").fill("2020-07-19");
  await tap(page.getByText("Save Child Profile"), "Save");
  await page.waitForTimeout(3000);

  const afterSave = await page.evaluate(() => document.body.innerText);
  check(/already registered with this coach or school/.test(afterSave),
    "a duplicate child is explained in English",
    afterSave.match(/Maya Tan[^\n]*/)?.[0]);
  check(!/23505|duplicate key|violates unique/i.test(afterSave),
    "no raw Postgres error reaches the parent");

  // POSITIVE CONTROL. Without this, the two checks above would pass just as
  // happily on a form where every save fails — "it was rejected" proves
  // nothing unless a legitimate save is known to succeed (§7.17: ask what the
  // guard does when nothing happened).
  await page.getByPlaceholder("Emma Tan").fill("Maya Tan");
  await page.getByPlaceholder("YYYY-MM-DD").fill("2022-01-05");
  await tap(page.getByText("Save Child Profile"), "Save (different DOB)");
  await page.waitForTimeout(3000);

  // Assert on NAVIGATION, not the toast: the success path router.back()s and
  // the toast auto-dismisses, so sampling it is a race. Leaving the form is
  // the durable signal — a rejected save keeps you on it, which is exactly
  // what happened for the duplicate above.
  const leftForm = await page
    .getByPlaceholder("Emma Tan")
    .isVisible()
    .catch(() => false);
  check(!leftForm,
    "a same-named child with a DIFFERENT birthday still saves (form closed)");

  // The DB-side confirmation is asserted by the caller, not here — an
  // in-page fetch that falls back to "inconclusive" on error is a check that
  // passes when nothing happened. See the run instructions at the top.

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: "/tmp/identity-error.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
