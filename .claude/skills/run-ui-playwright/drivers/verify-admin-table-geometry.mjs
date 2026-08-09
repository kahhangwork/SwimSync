// verify-admin-table-geometry.mjs — COLUMN GEOMETRY across every admin table.
//
// WHY THIS EXISTS. The Swimming Levels table shipped with its header row nested
// inside another row and stayed visibly broken in production for a week
// (§7.54). Every text-based assertion passed throughout: the labels were all
// present, correctly spelled, in the right order — merely hundreds of pixels
// from the data they named. Only a human eventually noticed.
//
// `verify-levels-table.mjs` has measured that one page since. This sweeps the
// rest — fourteen others plus `levels` itself as a cross-check.
//
// ⚠ THERE ARE DELIBERATELY TWO COPIES OF THE MEASUREMENT, NOT ONE. This file
// uses lib.mjs → measureTableGeometry / TABLE_GEOMETRY_TOLERANCE;
// verify-levels-table.mjs keeps its own inline copy and its own TOLERANCE.
// That is the RISK 9 call, not an oversight: verify-levels-table.mjs is the
// CALIBRATED REFERENCE (measured against a real 488px-broken page), so an edit
// to the shared helper must not be able to change what it asserts. §7.98 is
// the argument FOR the split — consolidating two "identical" helpers without
// reading both turned two attendance-guard checks red. If you change the
// measurement here, re-measure there before assuming they still agree.
//
// ⚠ ONLY THE FIRST <table> ON A PAGE IS MEASURED. /trials and /makeups each
// render two. Both are measured today because their first table has rows, but
// a second table on any page is invisible to this sweep — a known gap, not a
// silent pass, recorded so nobody reads "15/15" as "every table".
//
// ⚠ A SKIPPED PAGE IS NOT A PASSED PAGE, AND THIS FILE IS BUILT AROUND THAT.
// Several admin tables are empty on the seed stack, and a table with no body
// row has no column to be misaligned against. Those pages are SKIPPED, listed
// by name at the end, and — critically — a run that measures ZERO tables FAILS.
// A driver that asserts nothing and exits 0 is precisely §7.100 (two weeks of
// green on a driver that had stopped checking) and §7.79. "Checked" must never
// be able to mean "there was nothing there".
//
// Column WIDTH is reported, never asserted — see §7.71 and the note in lib.mjs.
//
// Prereqs (more fixtures = fewer skips; none is an error, it is a smaller run):
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-admin-table-geometry.sql
//   cd SwimSyncAdmin && npm run dev
// Run:
//   node drivers/verify-admin-table-geometry.mjs
//
// Admin-only — no Expo server, so nothing here contends for port 8081.

import {
  launch,
  loginAdmin,
  ADMIN,
  measureTableGeometry,
  settleForMeasurement,
  TABLE_GEOMETRY_TOLERANCE,
} from "./lib.mjs";

// Every admin route that renders a <Table>. Derived 2026-08-09 from
//   grep -rln "<Thead\|<Table" --include=page.tsx SwimSyncAdmin/app
// `levels` is included deliberately: it is the calibrated reference case, so a
// green there proves the shared helper still measures what the dedicated
// driver measures.
const ROUTES = [
  "admins",
  "attendance",
  "classes",
  "coaches",
  "credit-notes",
  "dashboard",
  "invoices",
  "levels",
  "makeups",
  "packages",
  "parents",
  // "platform" is deliberately ABSENT. It is the PLATFORM admin's overview of
  // every business, not a tenant-admin page: signed in as coach@swimsync.test
  // it renders no table at all, so including it produced a permanent skip that
  // read like missing fixture data when it is actually a missing ROLE. Covering
  // it needs a platform-admin session (and `superadmin@` has its own seed-login
  // trap — see run-ui-playwright/SKILL.md), which is a different driver.
  "students",
  "trials",
  "unassigned",
  "wages",
];

const NARROW_PX = 80; // reported only — see §7.71

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};

const measured = [];
const skipped = [];   // legitimately empty — reported, not failed
const errored = [];   // threw — FAILED above, listed again here for triage
const narrow = [];

const { browser, page } = await launch();

try {
  console.log("\n1. Sign in as the tenant admin");
  await loginAdmin(page, "coach@swimsync.test");

  console.log(`\n2. Measure ${ROUTES.length} admin tables`);
  for (const route of ROUTES) {
    let shape = null;
    try {
      await page.goto(`${ADMIN}/${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      await settleForMeasurement(page);
      shape = await measureTableGeometry(page);
    } catch (err) {
      // ⚠ A THROWN ROUTE IS A FAILURE, NOT A SKIP, and this used to be one.
      // Collapsing "the table is legitimately empty" and "the page blew up"
      // into the same non-failing bucket means the dev server dying after
      // route 8 prints "8 measured, 7 skipped" and exits 0 — a milder §7.100,
      // in the very file whose header says it is built against that. Only a
      // TOTALLY vacuous run failed before; now any broken route does.
      check(
        `/${route}: the page loaded and could be measured`,
        false,
        `${err.message.split("\n")[0]} — this is a broken route, not an empty table`
      );
      errored.push([route, err.message.split("\n")[0]]);
      continue;
    }

    if (!shape) {
      // No table, no headers, or no data row wider than one cell. All three
      // mean "nothing to measure" — never "measured and fine".
      skipped.push([route, "no table with a multi-cell data row (empty on this stack)"]);
      continue;
    }

    measured.push(route);
    console.log(`\n  ── /${route} — ${shape.thCount} columns`);

    check(
      `/${route}: the header row is not nested inside another row`,
      shape.nestedTrInThead === 0,
      `found ${shape.nestedTrInThead} <tr> inside <thead> <tr> — this is the §7.54 shape`
    );
    check(
      `/${route}: the first data row has the same number of cells as the header`,
      shape.tdCount === shape.thCount,
      `header ${shape.thCount} vs row ${shape.tdCount}: ${JSON.stringify(shape.headerTexts)}`
    );

    let worst = 0;
    let worstCol = null;
    for (const c of shape.cols) {
      if (c.tdLeft === null) continue;
      const delta = Math.abs(c.thLeft - c.tdLeft);
      if (delta > worst) { worst = delta; worstCol = c; }
      if (c.thWidth < NARROW_PX) narrow.push([route, c.header, c.thWidth]);
    }
    check(
      `/${route}: every header sits above its own data (worst Δ ${worst}px)`,
      worst <= TABLE_GEOMETRY_TOLERANCE,
      worstCol
        ? `"${worstCol.header}" header left ${worstCol.thLeft}px, data left ${worstCol.tdLeft}px ` +
          `(tolerance ${TABLE_GEOMETRY_TOLERANCE}px — do not raise it, see lib.mjs CALIBRATION)`
        : ""
    );
  }

  console.log(
    `\n3. Coverage — ${measured.length} measured, ${skipped.length} skipped, ` +
    `${errored.length} errored`
  );
  if (errored.length) {
    console.log("  ERRORED (already counted as failures above):");
    for (const [route, why] of errored) console.log(`    · /${route} — ${why}`);
  }
  if (skipped.length) {
    console.log("  SKIPPED (nothing to measure — NOT a pass):");
    for (const [route, why] of skipped) console.log(`    · /${route} — ${why}`);
    console.log(
      "  Load the fixture that fills these tables to widen the sweep; a skip is a\n" +
      "  gap in coverage, not a clean bill of health."
    );
  }

  // The whole point of the file. A sweep that measured nothing must not be
  // able to report success.
  check(
    "the sweep measured at least one table",
    measured.length > 0,
    "ZERO tables measured — every route was skipped, so this run asserted nothing " +
      "about geometry. Exiting 0 here is the §7.100 failure mode. Check the admin server " +
      "is up and the seed/fixtures are loaded."
  );

  if (narrow.length) {
    console.log(`\n4. FYI — ${narrow.length} column(s) narrower than ${NARROW_PX}px (§7.71, reported not asserted)`);
    for (const [route, header, w] of narrow) console.log(`    · /${route} "${header}" ${w}px`);
    console.log("  Alignment cannot catch a uniformly squeezed column. Worth a human look.");
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed  (${measured.length}/${ROUTES.length} tables measured)`);
process.exit(fail === 0 ? 0 : 1);
