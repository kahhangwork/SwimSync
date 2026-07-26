// verify-class-students.mjs — the admin Classes page's "See students" drawer
// and its "2+1" count badge.
//
// WHY A DRIVER AND NOT JUST UNIT TESTS. This change is ENTIRELY a read path,
// and a read path is exactly what unit tests cannot reach: §7.48 has fired
// three times in this project, each time a policy gap that made a working
// feature indistinguishable from one nobody wrote. The enrolment → students →
// tenant_levels join is new for the tenant-admin role, so the only thing that
// can prove it is a real login against real RLS.
//
// Two rules this driver holds itself to:
//   1. It authenticates as the TENANT ADMIN through the login form. It never
//      reads through the service-role key anything it then asserts on — that
//      would bypass the very policies under test.
//   2. Every "X must not be on screen" check is preceded by a database check
//      that X EXISTS. An absence assertion against a row that was never
//      created passes while proving nothing.
//
// Prereqs:
//   docker Supabase stack up; fixture applied:
//     docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//       < drivers/fixtures-class-students.sql
//   admin dev server on 3100 (NOT 3000 — other worktrees may hold it):
//     cd SwimSyncAdmin && npm run dev -- -p 3100
// Run:
//   ADMIN_URL=http://localhost:3100 node drivers/verify-class-students.mjs
//
// No Expo server is needed: everything here is admin-side.

import { execSync } from "node:child_process";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const CLASS_ID = "c5000000-0000-0000-0000-0000000000C1";
const CLASS_TITLE = "ClsRoster Class";

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

(async () => {
  // ── 0. The fixture is real ────────────────────────────────────────────────
  // Runs FIRST and hard-exits on failure. Everything below is either an
  // assertion about these rows or an assertion about their absence from the
  // screen; if they are not here, the run is vacuous rather than green.
  console.log("\n0. Fixture exists in the database (guards against vacuous checks)");

  const enrolled = sql(`
    SELECT string_agg(s.full_name, ',' ORDER BY s.full_name)
      FROM student_class_enrolments e JOIN students s ON s.id = e.student_id
     WHERE e.class_id = '${CLASS_ID}' AND e.is_active`);
  check("two ACTIVE enrolments seeded (Anna, Ben)",
    enrolled === "ClsRoster Anna,ClsRoster Ben", `got "${enrolled}"`);

  const closed = sql(`
    SELECT string_agg(s.full_name, ',')
      FROM student_class_enrolments e JOIN students s ON s.id = e.student_id
     WHERE e.class_id = '${CLASS_ID}' AND NOT e.is_active`);
  check("a CLOSED enrolment exists (Chloe) — the is_active control",
    closed === "ClsRoster Chloe", `got "${closed}"`);

  const upcoming = sql(`
    SELECT string_agg(s.full_name, ',')
      FROM trial_bookings tb JOIN students s ON s.id = tb.student_id
     WHERE tb.class_id = '${CLASS_ID}' AND tb.cancelled_at IS NULL
       AND tb.session_date >= (now() AT TIME ZONE 'Asia/Singapore')::date`);
  check("one UPCOMING live trial exists (Dev)",
    upcoming === "ClsRoster Dev", `got "${upcoming}"`);

  const past = sql(`
    SELECT string_agg(s.full_name, ',')
      FROM trial_bookings tb JOIN students s ON s.id = tb.student_id
     WHERE tb.class_id = '${CLASS_ID}' AND tb.cancelled_at IS NULL
       AND tb.session_date < (now() AT TIME ZONE 'Asia/Singapore')::date`);
  check("a PAST trial exists (Eve) — the date control",
    past === "ClsRoster Eve", `got "${past}"`);

  const cancelled = sql(`
    SELECT string_agg(s.full_name, ',')
      FROM trial_bookings tb JOIN students s ON s.id = tb.student_id
     WHERE tb.class_id = '${CLASS_ID}' AND tb.cancelled_at IS NOT NULL
       AND tb.session_date >= (now() AT TIME ZONE 'Asia/Singapore')::date`);
  check("a CANCELLED but future-dated trial exists (Finn) — the cancel control",
    cancelled === "ClsRoster Finn", `got "${cancelled}"`);

  const level = sql(`
    SELECT l.label FROM students s JOIN tenant_levels l ON l.id = s.level_id
     WHERE s.full_name = 'ClsRoster Anna'`);
  check("Anna has a level set — proves the embed resolved, not that it is empty",
    level === "ClsRoster Otter", `got "${level}"`);

  if (fail > 0) {
    console.log("\nFixture is not in place. Apply fixtures-class-students.sql first.");
    process.exit(1);
  }

  // ── 1. Sign in as the TENANT ADMIN and open Classes ───────────────────────
  const { browser, page } = await launch();
  try {
    console.log("\n1. Classes page as the tenant admin");
    // coach@swimsync.test is the tenant admin AND a coach — the shape
    // production has (a private coach is a tenant of one).
    await loginAdmin(page, "coach@swimsync.test");
    await page.goto(`${ADMIN}/classes`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const row = page.locator("tr", { hasText: CLASS_TITLE });
    await row.first().waitFor({ state: "visible", timeout: 15000 });
    check("the fixture class is listed", await row.count() > 0);

    const badge = row.first().getByTitle(/enrolled/);
    const badgeText = (await badge.innerText()).trim();
    check('the count badge reads "2+1"', badgeText === "2+1", `got "${badgeText}"`);
    // Spelled out individually: each of these is a specific way the rule could
    // have been got wrong, and "not 2+1" alone would not say which.
    check('  … and NOT "3" (trials merged into the enrolled count)', badgeText !== "3");
    check('  … and NOT "2+3" (past + cancelled trials counted)', badgeText !== "2+3");
    check('  … and NOT "2+2" (one of past/cancelled counted)', badgeText !== "2+2");
    check('  … and NOT "3+1" (the closed enrolment counted)', badgeText !== "3+1");

    const tip = await badge.getAttribute("title");
    check('the badge tooltip spells the split out in words',
      tip === "2 enrolled + 1 trial booked", `got "${tip}"`);

    // The Risk-1 guard, from the UI side: the roster is fetched by its own
    // query precisely so that a failure there cannot blank this table. The
    // seed stack has one class of its own; production has several. Assert the
    // seed class by NAME rather than a row count, so this does not silently
    // weaken into "some rows exist".
    const otherClass = page.locator("tr", { hasText: "Saturday Beginners" });
    check("other classes still render alongside the fixture class",
      (await otherClass.count()) > 0);
    const allRows = await page.locator("tbody tr").count();
    check("the class table has every class it should (≥ 2 here)", allRows >= 2,
      `got ${allRows} rows`);

    // ── 2. Open the drawer ──────────────────────────────────────────────────
    console.log("\n2. The drawer");
    await row.first().getByRole("button", { name: "See students" }).click();
    const drawer = page.getByRole("dialog");
    await drawer.waitFor({ state: "visible", timeout: 8000 });
    check("the drawer opens", await drawer.isVisible());

    const text = await drawer.innerText();

    check("headed with the class name", text.includes(CLASS_TITLE));
    // Case-insensitive: the headings carry Tailwind's `uppercase`, and
    // innerText returns TRANSFORMED text, so an exact-case match would test
    // the stylesheet rather than the count.
    check('the "Enrolled (2)" heading is right', /Enrolled \(2\)/i.test(text),
      `drawer text: ${text.slice(0, 200)}`);
    check('the "Trials coming up (1)" heading is right',
      /Trials coming up \(1\)/i.test(text));

    // PRESENCE — by name. An empty drawer must fail, not pass quietly: this is
    // the assertion that catches an RLS gap (§7.48).
    check("Anna is listed", text.includes("ClsRoster Anna"));
    check("Ben is listed", text.includes("ClsRoster Ben"));
    check("Dev is listed under trials", text.includes("ClsRoster Dev"));

    // ABSENCE — safe to assert now that step 0 proved all three exist.
    check("Chloe (closed enrolment) is NOT listed", !text.includes("ClsRoster Chloe"));
    check("Eve (past trial) is NOT listed", !text.includes("ClsRoster Eve"));
    check("Finn (cancelled trial) is NOT listed", !text.includes("ClsRoster Finn"));

    // Level + dates. A failed tenant_levels embed would render "No level set"
    // for everyone, which looks like data rather than a bug.
    check('Anna\'s level label renders ("ClsRoster Otter")',
      text.includes("ClsRoster Otter"));
    check('Ben, who has no level, reads "No level set"',
      text.includes("No level set"));
    check("Anna's joined date renders (4 May 2026)", text.includes("4 May 2026"));
    check("Dev's row is labelled as a trial with a date",
      /Trial on\s+\w/.test(text), `drawer text: ${text.slice(0, 400)}`);

    // ── 3. No write affordance ──────────────────────────────────────────────
    // The one action an admin might reach for here is assigning the trial
    // child to the class — and that is precisely what breaks billing
    // (PRD §7.17). The check is on CONTROLS, not on the text: the warning
    // prose deliberately talks about not adding them to the class, so a bare
    // string search would flag the mitigation as the problem.
    console.log("\n3. Read-only: no control can act on this class");
    const controls = await drawer.locator("button, a").allInnerTexts();
    const actionable = controls.filter((t) =>
      /assign|enroll?|remove|delete|unenroll?/i.test(t)
    );
    check("no Assign / Enrol / Remove control in the drawer",
      actionable.length === 0, `found: ${JSON.stringify(actionable)}`);

    check("the trials panel states the consequence of enrolling them",
      /expected every week/i.test(text) && /invoiced/i.test(text));

    // ── 4. Close ────────────────────────────────────────────────────────────
    console.log("\n4. Closing");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check("Esc closes the drawer", !(await page.getByRole("dialog").isVisible().catch(() => false)));
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
