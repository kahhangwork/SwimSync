// verify-multi-class.mjs — a child in more than one class (Wave 2,
// 20260811000100).
//
// WHY A DRIVER. Multiple enrolments is almost entirely a READ-path change:
// five surfaces used `.find(e => e.is_active)` and each one silently showed the
// first of two. A unit test on the mapping proves the mapping; only a real
// login proves that the tenant-admin and parent RLS policies actually return
// BOTH rows, which is the §7.48 failure this project has hit three times — a
// policy gap that makes a working feature indistinguishable from one nobody
// wrote.
//
// Two rules this driver holds itself to:
//   1. It authenticates through the login form as the role under test. It never
//      reads through the service-role key anything it then asserts on.
//   2. Every "must not be on screen" check is preceded by a database check that
//      the thing EXISTS. An absence assertion against a row that was never
//      created passes while proving nothing.
//
// ⚠ SABOTAGE SIGNATURE (§7.25 — what this looks like when it is working).
// MEASURED 2026-08-10, not predicted:
//   • Students page truncated to the first class (`classes.splice(1)`) → the run
//     does NOT complete. "Amelia's Class cell shows BOTH classes" and the chip
//     guard fail (`Amelia 1 -> 2`), then the removal step throws because there
//     is no Wednesday chip to click. An aborted run IS the signal here.
//   • `DROP TRIGGER trg_enrolment_schedule` → 15/17. The clash check fails with
//     "the insert SUCCEEDED", and the removal check fails as a knock-on
//     (`2 active -> want 1`) because the clash row it just inserted survived.
// If a change makes this driver go GREEN while either is reverted, the checks
// have stopped discriminating — fix the driver, not the score.
//
// One check has already been caught being vacuous this way: see check 6.
//
// ⚠ THIS DRIVER MUTATES STATE AND IS NOT RE-RUNNABLE ON ITS OWN. It removes one
// of Amelia's classes through the UI, and the fixture's NOT EXISTS guard is
// keyed on (student, class) regardless of is_active — so a second run finds the
// Wednesday row present-but-closed and does not restore it. Apply the TEARDOWN
// then the fixture between runs. (run-all-drivers.sh resets per driver, so this
// only bites a hand-run.)
//
// ⚠ THE REVEAL GUARD IS THE POINT OF CHECK 3. Asserting "Mon" and "Wed" are both
// on screen is not enough: the Students page renders every child, and another
// fixture's row could supply either string. The guard counts chips WITHIN
// Amelia's own row, so a passing check means her row holds two.
//
// Prereqs:
//   docker Supabase stack up; fixture applied:
//     docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//       < drivers/fixtures-multi-class.sql
//   admin dev server on 3100 (NOT 3000 — other worktrees may hold it):
//     cd SwimSyncAdmin && npm run dev -- -p 3100
//   expo web on 8082:
//     cd SwimSyncApp && npx expo start --web --port 8082
// Run:
//   ADMIN_URL=http://localhost:3100 EXPO_URL=http://localhost:8082 \
//     node drivers/verify-multi-class.mjs
// Teardown:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-multi-class-teardown.sql

import { execSync } from "node:child_process";
import { launch, loginAdmin, loginExpo, ADMIN, EXPO, visibleText } from "./lib.mjs";

const AMELIA = "c6000000-0000-0000-0000-00000000000e";
const BEN = "c6000000-0000-0000-0000-00000000000f";
const CLASH_CLASS = "c6000000-0000-0000-0000-00000000000c";
const MONDAY_CLASS = "c6000000-0000-0000-0000-00000000000a";
const PARENT_EMAIL = "multicls-parent@swimsync.test";

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

/** Runs a statement expecting it to FAIL, and returns the error text. */
function sqlExpectError(q) {
  try {
    sql(q);
    return null;
  } catch (e) {
    return String(e.stderr ?? e.message ?? e);
  }
}

/**
 * Same, but AS a signed-in user. book_makeup() reads auth.uid() and refuses
 * outright without one, so a bare psql call returns "not authenticated" — a
 * pass-looking failure that proves nothing about the refusal under test.
 * Wrapped in a transaction so SET LOCAL applies and nothing is committed.
 */
function sqlAsExpectError(profileId, q) {
  return sqlExpectError(
    `BEGIN; SET LOCAL ROLE authenticated;
     SET LOCAL "request.jwt.claims" TO '{"sub":"${profileId}","role":"authenticated"}';
     ${q}; ROLLBACK;`
  );
}

(async () => {
  // ── 0. The fixture is real ────────────────────────────────────────────────
  // Runs FIRST and hard-exits. Every assertion below is either an existence
  // claim about these rows or an absence claim that is vacuous without them.
  const ameliaClasses = Number(
    sql(
      `SELECT count(*) FROM student_class_enrolments
        WHERE student_id = '${AMELIA}' AND is_active`
    )
  );
  const benClasses = Number(
    sql(
      `SELECT count(*) FROM student_class_enrolments
        WHERE student_id = '${BEN}' AND is_active`
    )
  );
  if (ameliaClasses !== 2 || benClasses !== 1) {
    console.error(
      `✗ FIXTURE NOT LOADED — Amelia has ${ameliaClasses} active classes (want 2), ` +
        `Ben has ${benClasses} (want 1). Apply fixtures-multi-class.sql first.`
    );
    process.exit(1);
  }
  console.log("Fixture verified: Amelia 2 classes, Ben 1.\n");

  const { browser, page } = await launch();

  try {
    // ══ ADMIN ══════════════════════════════════════════════════════════════
    console.log("Admin — Students page");
    // coach@swimsync.test, NOT the default superadmin: the seed superadmin is a
    // PLATFORM admin, and the eleven single-business pages refuse them by design
    // (PRD §4.4, LOCAL_DEV_GUIDE seed table). Logging in as the platform admin
    // renders "This page shows a single business." and zero rows — which reads
    // exactly like a broken query.
    await loginAdmin(page, "coach@swimsync.test");
    await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // 1-2. Both classes render, and they render in Amelia's OWN row.
    const ameliaRow = page.locator("tr", { hasText: "MultiCls Amelia" }).first();
    await ameliaRow.waitFor({ timeout: 10_000 });
    const ameliaRowText = (await ameliaRow.innerText()).replace(/\s+/g, " ");

    check(
      "Amelia's row is on the Students page",
      ameliaRowText.includes("MultiCls Amelia"),
      ameliaRowText.slice(0, 160)
    );

    check(
      "Amelia's Class cell shows BOTH classes (Mon and Wed)",
      ameliaRowText.includes("Mon") && ameliaRowText.includes("Wed"),
      ameliaRowText.slice(0, 200)
    );

    // 3. THE REVEAL GUARD. The per-class Remove controls moved into the Actions
    // drawer (the Class column is view-only), so count them THERE: one per class.
    // Two means Amelia genuinely holds two classes, not that the page happens to
    // contain both strings somewhere.
    const benRow = page.locator("tr", { hasText: "MultiCls Ben" }).first();
    await ameliaRow.getByRole("button", { name: /^Actions$/ }).click();
    await page.waitForTimeout(400);
    const ameliaChips = await page
      .locator('button[aria-label^="Remove MultiCls Amelia from"]')
      .count();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await benRow.getByRole("button", { name: /^Actions$/ }).click();
    await page.waitForTimeout(400);
    const benChips = await page
      .locator('button[aria-label^="Remove MultiCls Ben from"]')
      .count();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(
      "class count is per-child (via the drawer): Amelia 2, Ben 1",
      ameliaChips === 2 && benChips === 1,
      `Amelia ${ameliaChips} -> 2, Ben ${benChips} -> 1`
    );

    // 4. The single-class control still reads normally. This is what stops
    // "show every class" from being indistinguishable from "show everything".
    const benRowText = (await benRow.innerText()).replace(/\s+/g, " ");
    check(
      "Ben, in ONE class, shows Mon and not Wed",
      benRowText.includes("Mon") && !benRowText.includes("Wed"),
      benRowText.slice(0, 160)
    );

    // 5. Add class is offered — it now lives in the per-row Actions drawer
    // (the Class column is view-only). Open the drawer, assert, then close it.
    await ameliaRow.getByRole("button", { name: /^Actions$/ }).click();
    await page.waitForTimeout(400);
    check(
      "an Add class control is offered in the Actions drawer",
      (await page.getByRole("button", { name: /Add class/i }).count()) > 0
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 6. The Coach column does not print one coach twice. Both of Amelia's
    // classes belong to the seed coach, so a naive join prints the name twice.
    //
    // ⚠ THE NAME IS READ FROM THE DATABASE, NOT HARDCODED. The first version of
    // this check counted /Coach Wei/ — a name this seed does not use — so it
    // matched zero times, satisfied `<= 1`, and passed while testing nothing.
    // Caught only because a sabotage run printed the row and the real name
    // ("Coach Marcus") was visible in it.
    const coachName = sql(
      `SELECT pr.full_name FROM classes c
         JOIN coaches co ON co.id = c.coach_id
         JOIN profiles pr ON pr.id = co.profile_id
        WHERE c.id = '${MONDAY_CLASS}'`
    );
    const coachRepeats = coachName
      ? (ameliaRowText.match(new RegExp(coachName, "g")) ?? []).length
      : 0;
    check(
      "the Coach cell lists each coach once, not once per class",
      coachName !== "" && coachRepeats === 1,
      `"${coachName}" appears ${coachRepeats}x -> want exactly 1`
    );

    // ══ THE TRIGGERS, through the database rather than the UI ══════════════
    // These are server-side refusals with no screen of their own; the UI check
    // is that the admin never gets offered the state (checks 5/9), and this is
    // the check that the guard behind it actually holds.
    console.log("\nSchedule invariant");

    const clashErr = sqlExpectError(
      `INSERT INTO student_class_enrolments (student_id, class_id, is_active)
       VALUES ('${AMELIA}', '${CLASH_CLASS}', TRUE)`
    );
    check(
      "an OVERLAPPING enrolment is refused, naming the clashing class",
      !!clashErr && /clashes with/.test(clashErr) && /MultiCls Monday/.test(clashErr),
      clashErr ? clashErr.slice(0, 200) : "the insert SUCCEEDED"
    );

    const dupErr = sqlExpectError(
      `INSERT INTO student_class_enrolments (student_id, class_id, is_active)
       VALUES ('${AMELIA}', '${MONDAY_CLASS}', TRUE)`
    );
    check(
      "the SAME class twice is refused by the unique index, not the trigger",
      !!dupErr && /one_active_enrolment_per_student_class/.test(dupErr),
      dupErr ? dupErr.slice(0, 200) : "the insert SUCCEEDED"
    );

    const moveErr = sqlExpectError(
      `UPDATE classes SET day_of_week = 'monday'
        WHERE id = 'c6000000-0000-0000-0000-00000000000b'`
    );
    check(
      "moving a class onto a clashing time is refused, naming the child",
      !!moveErr && /MultiCls Amelia/.test(moveErr),
      moveErr ? moveErr.slice(0, 200) : "the update SUCCEEDED"
    );

    // A non-schedule edit must NOT be refused — this is the check that would
    // catch someone widening the classes trigger onto is_active, which would
    // give reactivate_class() a refusal it must never have.
    const renameErr = sqlExpectError(
      `UPDATE classes SET location_name = 'MultiCls Pool 2'
        WHERE id = 'c6000000-0000-0000-0000-00000000000b'`
    );
    check(
      "a NON-schedule edit to the same class is allowed",
      renameErr === null,
      renameErr ? renameErr.slice(0, 160) : ""
    );
    sql(
      `UPDATE classes SET location_name = 'MultiCls Pool'
        WHERE id = 'c6000000-0000-0000-0000-00000000000b'`
    );

    // ══ MAKE-UPS ═══════════════════════════════════════════════════════════
    // The silent-void case: booking a make-up into the child's OTHER class.
    // Server-side, because the UI's job is never to offer it and the guard's
    // job is to refuse it if anything does.
    console.log("\nMake-ups");

    // The tenant admin's auth id — book_makeup() is admin-only.
    const adminUid = sql(
      `SELECT id FROM auth.users WHERE email = 'coach@swimsync.test'`
    );

    const ownClassErr = sqlAsExpectError(
      adminUid,
      `SELECT book_makeup('c6000000-0000-0000-0000-00000000000b',
                          (date_trunc('week', CURRENT_DATE) + interval '9 days')::date,
                          '${AMELIA}', '${MONDAY_CLASS}')`
    );
    check(
      "⚠ a make-up into the child's OTHER class is refused",
      !!ownClassErr && /own classes/.test(ownClassErr),
      ownClassErr ? ownClassErr.slice(0, 200) : "the booking SUCCEEDED"
    );

    const noHomeErr = sqlAsExpectError(
      adminUid,
      `SELECT book_makeup('c6000000-0000-0000-0000-00000000000c',
                          (date_trunc('week', CURRENT_DATE) + interval '7 days')::date,
                          '${AMELIA}', NULL)`
    );
    check(
      "a two-class child must have their home class named",
      !!noHomeErr && /more than one class/.test(noHomeErr),
      noHomeErr ? noHomeErr.slice(0, 200) : "the booking SUCCEEDED"
    );

    // ══ PARENT APP ═════════════════════════════════════════════════════════
    console.log("\nParent app — Home");
    await loginExpo(page, PARENT_EMAIL);
    await page.waitForTimeout(1500);
    const homeText = await visibleText(page);

    check(
      "the parent's Home card names Amelia",
      homeText.includes("MultiCls Amelia"),
      homeText.slice(0, 200)
    );

    // Both weekdays present. The parent app shows only THIS family's children,
    // so unlike the admin table there is no other row to supply the strings —
    // Ben is Monday-only, so "Wednesday" can only have come from Amelia.
    check(
      "the Home card shows BOTH of Amelia's class days",
      /Monday/i.test(homeText) && /Wednesday/i.test(homeText),
      homeText.slice(0, 300)
    );

    // ══ REMOVE ONE CLASS, through the UI ═══════════════════════════════════
    // The write path, and the assertion that it is per-class rather than
    // per-child: the OTHER enrolment must survive, and the child must stay
    // 'assigned' because they are still in a class.
    console.log("\nAdmin — removing ONE class");
    await loginAdmin(page, "coach@swimsync.test");
    await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const row2 = page.locator("tr", { hasText: "MultiCls Amelia" }).first();
    await row2.waitFor({ timeout: 10_000 });
    // Ending an enrolment now lives in the Actions drawer: open it, click the
    // per-class Remove, then confirm in the modal it opens.
    await row2.getByRole("button", { name: /^Actions$/ }).click();
    await page.waitForTimeout(400);
    await page
      .locator('button[aria-label="Remove MultiCls Amelia from MultiCls Wednesday"]')
      .click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /^Remove$/ }).click();
    await page.waitForTimeout(1200);

    const leftActive = Number(
      sql(
        `SELECT count(*) FROM student_class_enrolments
          WHERE student_id = '${AMELIA}' AND is_active`
      )
    );
    check(
      "removing one class leaves the other enrolment active",
      leftActive === 1,
      `${leftActive} active -> want 1`
    );

    const status = sql(
      `SELECT assignment_status FROM students WHERE id = '${AMELIA}'`
    );
    check(
      "the child is still ASSIGNED — they are still in a class",
      status === "assigned",
      `status=${status}`
    );

    const closedWed = Number(
      sql(
        `SELECT count(*) FROM student_class_enrolments
          WHERE student_id = '${AMELIA}'
            AND class_id = 'c6000000-0000-0000-0000-00000000000b'
            AND NOT is_active AND unenrolled_at IS NOT NULL`
      )
    );
    check(
      "the removed enrolment is CLOSED, not deleted",
      closedWed === 1,
      `${closedWed} closed rows -> want 1`
    );
  } finally {
    await browser.close();
  }

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail > 0) process.exit(1);
})();
