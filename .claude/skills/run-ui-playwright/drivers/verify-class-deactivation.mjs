// verify-class-deactivation.mjs — retiring and restoring a class from the admin
// Classes page (Wave 1 item #6, Chunk 4).
//
// ⚠ CHECK 7 IS THE ONE THIS DRIVER EXISTS FOR, AND IT IS A DEPLOY GATE.
// The invoice engine no longer skips inactive classes, so a retired class can
// BLOCK a billing month — and the coach class list and the coach Schedule tab
// both still filter `is_active`, which leaves this page as the only screen in
// the product that can show one. RISK 1's mitigation is precisely that the
// retire → reload → restore round trip completes THROUGH THE UI ALONE, touching
// no SQL. If check 7 cannot be made green, 4.1 must not deploy: the alternative
// is a month that blocks on a class nobody can see, with no override by design.
//
// WHY THE REFUSALS ARE DRIVEN TOO. A page that could retire anything would pass
// the round trip while having lost all three guards. Checks 8-11 prove the
// refusal reaches the screen AND names what is in the way — an error the admin
// cannot act on is the dead end the guard was supposed to prevent.
//
// §7.28 — `is_active` exists on `students`, on `student_class_enrolments` AND on
// `classes`, and this page embeds `student_class_enrolments(id, is_active)`.
// Read off the wrong nesting level it typechecks clean and renders EVERY class
// retired. Check 3 asserts a KNOWN-ACTIVE class is not badged, which is the only
// assertion here that catches that; asserting only on the retired one would go
// green against exactly that bug.
//
// Prereqs:
//   docker Supabase stack up; fixture applied:
//     docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//       < drivers/fixtures-class-deactivation.sql
//   admin dev server on 3100 (NOT 3000 — other worktrees may hold it):
//     cd SwimSyncAdmin && npm run dev -- -p 3100
// Run:
//   ADMIN_URL=http://localhost:3100 node drivers/verify-class-deactivation.mjs
//
// No Expo server is needed: everything here is admin-side.

import { execSync } from "node:child_process";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const EMPTY = "c9000000-0000-0000-0000-0000000000e1";
const ENROLLED = "c9000000-0000-0000-0000-0000000000e2";
const BOOKED = "c9000000-0000-0000-0000-0000000000e3";

const EMPTY_TITLE = "ClsRetire Empty Class";
const ENROLLED_TITLE = "ClsRetire Enrolled Class";
const BOOKED_TITLE = "ClsRetire Booked Class";

let pass = 0;
let fail = 0;

function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function sql(q) {
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc ${JSON.stringify(
      q.replace(/\n/g, " ")
    )}`,
    { encoding: "utf8" }
  ).trim();
}

/** The row for a class, by its visible title. Never by ordinal position: on a
 *  shared stack nth(n) resolves against whatever fixtures happen to be loaded,
 *  and a write to the wrong row is data corruption, not a flaky selector. */
function rowFor(page, title) {
  return page.locator("tr", { hasText: title });
}

(async () => {
  // ── 0. The fixture is real ────────────────────────────────────────────────
  // Runs FIRST and hard-exits. Every check below is either about these rows or
  // about their absence; if they are not here the run is vacuous, not green.
  console.log("\n0. Fixture exists in the database (guards against vacuous checks)");

  const titles = sql(`
    SELECT string_agg(title, ',' ORDER BY title) FROM classes
     WHERE id IN ('${EMPTY}','${ENROLLED}','${BOOKED}')`);
  check("three fixture classes seeded",
    titles === `${BOOKED_TITLE},${EMPTY_TITLE},${ENROLLED_TITLE}`, `got "${titles}"`);

  const allActive = sql(`
    SELECT count(*) FROM classes
     WHERE id IN ('${EMPTY}','${ENROLLED}','${BOOKED}') AND is_active`);
  check("all three start ACTIVE — the round trip needs somewhere to start",
    allActive === "3", `got ${allActive}`);

  const blocker = sql(`
    SELECT s.full_name FROM student_class_enrolments e
      JOIN students s ON s.id = e.student_id
     WHERE e.class_id = '${ENROLLED}' AND e.is_active`);
  check("the enrolled class really has a live enrolment (Mia)",
    blocker === "ClsRetire Mia", `got "${blocker}"`);

  const guest = sql(`
    SELECT s.full_name FROM trial_bookings tb
      JOIN students s ON s.id = tb.student_id
     WHERE tb.class_id = '${BOOKED}' AND tb.cancelled_at IS NULL
       AND tb.session_date >= (now() AT TIME ZONE 'Asia/Singapore')::date`);
  check("the booked class really has a FUTURE trial (Noah)",
    guest === "ClsRetire Noah", `got "${guest}"`);

  const emptyIsEmpty = sql(`
    SELECT (SELECT count(*) FROM student_class_enrolments WHERE class_id = '${EMPTY}')
         + (SELECT count(*) FROM trial_bookings WHERE class_id = '${EMPTY}')
         + (SELECT count(*) FROM lesson_sessions WHERE class_id = '${EMPTY}')`);
  check("the empty class is genuinely empty — otherwise check 7 refuses",
    emptyIsEmpty === "0", `got ${emptyIsEmpty}`);

  if (fail > 0) {
    console.log("\nFixture is not in place. Apply fixtures-class-deactivation.sql first.");
    process.exit(1);
  }

  const { browser, page } = await launch();
  try {
    // ── 1. Classes page as the tenant admin ─────────────────────────────────
    console.log("\n1. Classes page as the tenant admin");
    // coach@swimsync.test is the tenant admin AND a coach — the shape
    // production has (a private coach is a tenant of one).
    await loginAdmin(page, "coach@swimsync.test");
    await page.goto(`${ADMIN}/classes`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    await rowFor(page, EMPTY_TITLE).first().waitFor({ state: "visible", timeout: 15000 });
    check("the fixture classes are listed", await rowFor(page, EMPTY_TITLE).count() > 0);

    // ── 2. The toggle exists and defaults to HIDDEN ─────────────────────────
    console.log("\n2. The Show retired toggle");
    const toggle = page.getByLabel(/show retired/i);
    check("a 'Show retired classes' toggle is on the page",
      await toggle.count() > 0);
    check("and it starts UNCHECKED — retired classes are clutter until they block",
      (await toggle.isChecked()) === false);

    // ── 3. §7.28: an ACTIVE class must NOT be badged retired ────────────────
    // The assertion that catches reading is_active off the enrolment embed.
    // Without it, a page that badges EVERY class retired passes checks 4-7.
    console.log("\n3. §7.28 — the class's own is_active, not the enrolment's");
    const activeRowText = await rowFor(page, ENROLLED_TITLE).first().innerText();
    check("a known-ACTIVE class carries NO 'Retired' badge",
      !/retired/i.test(activeRowText), `row read: ${JSON.stringify(activeRowText)}`);

    // ── 4-6. Retire the empty class ─────────────────────────────────────────
    console.log("\n4. Retiring the empty class");
    await rowFor(page, EMPTY_TITLE).first().getByRole("button", { name: /retire/i }).click();
    await page.waitForTimeout(600);

    const dialogText = await page.locator("body").innerText();
    check("the confirm says already-taught lessons still bill",
      /still bill/i.test(dialogText));

    await page.getByRole("button", { name: /^retire class$/i }).click();
    await page.waitForTimeout(2000);

    const retiredInDb = sql(
      `SELECT is_active::text || ',' || (deactivated_at IS NOT NULL)::text
         FROM classes WHERE id = '${EMPTY}'`);
    check("the class is retired in the database, WITH a date",
      retiredInDb === "false,true", `got "${retiredInDb}"`);

    // The row must vanish from the default view — otherwise "hidden by default"
    // is not true and the toggle is decoration.
    await page.waitForTimeout(500);
    check("it drops out of the default (active-only) list",
      await rowFor(page, EMPTY_TITLE).count() === 0);

    // ── 7. THE ROUND TRIP — the deploy gate ─────────────────────────────────
    // Reload first, deliberately: RISK 1 is about a class that is gone AFTER a
    // fresh page load, which is when `loadClasses()` runs again. Restoring from
    // a row still sitting in React state from before would prove nothing.
    console.log("\n5. Reload, reveal, restore — RISK 1's round trip, no SQL");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    check("after a RELOAD it is still hidden (not just stale state)",
      await rowFor(page, EMPTY_TITLE).count() === 0);

    await page.getByLabel(/show retired/i).check();
    await page.waitForTimeout(800);

    const revealed = rowFor(page, EMPTY_TITLE);
    check("ticking 'Show retired' reveals it",
      await revealed.count() > 0);
    check("and it is badged 'Retired' so the state is visible, not inferred",
      /retired/i.test(await revealed.first().innerText()));

    await revealed.first().getByRole("button", { name: /restore/i }).click();
    await page.waitForTimeout(2000);

    const restored = sql(
      `SELECT is_active::text || ',' || (deactivated_at IS NULL)::text
         FROM classes WHERE id = '${EMPTY}'`);
    check("⚠ ROUND TRIP COMPLETE: restored through the UI alone, date cleared",
      restored === "true,true", `got "${restored}"`);

    // ── 8-11. The refusals reach the screen and NAME the obstruction ────────
    console.log("\n6. The refusals are rendered, not swallowed");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    await rowFor(page, ENROLLED_TITLE).first().getByRole("button", { name: /retire/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^retire class$/i }).click();
    await page.waitForTimeout(1800);

    const enrolErr = await page.locator("body").innerText();
    check("a class with a child enrolled is refused ON SCREEN",
      /still has children/i.test(enrolErr), "no refusal text found");
    check("  … and the message NAMES the child, so the admin can act",
      /ClsRetire Mia/.test(enrolErr));

    const stillActive = sql(`SELECT is_active FROM classes WHERE id = '${ENROLLED}'`);
    check("  … and nothing was written — a gate that raises after writing is not a gate",
      stillActive === "t", `got "${stillActive}"`);

    await page.getByRole("button", { name: /^cancel$/i }).click();
    await page.waitForTimeout(600);

    await rowFor(page, BOOKED_TITLE).first().getByRole("button", { name: /retire/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^retire class$/i }).click();
    await page.waitForTimeout(1800);

    const bookErr = await page.locator("body").innerText();
    check("a class with a future guest booked is refused, naming child and date",
      /guests booked/i.test(bookErr) && /ClsRetire Noah/.test(bookErr),
      "no booking refusal found");

    const bookedStillActive = sql(`SELECT is_active FROM classes WHERE id = '${BOOKED}'`);
    check("  … and that refusal wrote nothing either",
      bookedStillActive === "t", `got "${bookedStillActive}"`);
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
