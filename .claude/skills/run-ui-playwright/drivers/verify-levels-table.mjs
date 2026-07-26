// verify-levels-table.mjs — the Swimming Levels table's COLUMN GEOMETRY.
//
// WHY GEOMETRY AND NOT TEXT. levels/page.tsx wrapped its <Th>s in a <Tr> while
// <Thead> already emits its own, producing <tr> inside <tr>. The five headers
// collapsed into a single anonymous cell in column 1, which then absorbed the
// table's slack width — so the headers clustered at the left and the data sat
// hundreds of pixels away from the header naming it.
//
// EVERY TEXT ASSERTION PASSES ON THAT PAGE. The labels are all present, in the
// right order, with the right values; they are simply in the wrong place. The
// page shipped visibly broken to production for a week for exactly this
// reason. So this driver MEASURES rects from the DOM — the same
// measure-don't-eyeball approach verify-invoice-controls.mjs uses for the
// toggle knob (`docs/GOTCHAS.md` §7.34).
//
// CALIBRATION — measured, not guessed (1280px viewport, this machine):
//   broken  → worst header/data offset  488 px   (Level 316, Skills 449,
//                                                 Students 488, Actions 432)
//   fixed   → worst header/data offset    0 px
// TOLERANCE is 2px: a ~244x margin against the broken value, while still
// absorbing sub-pixel layout and font rounding. Do not raise it without
// re-measuring the broken case — a tolerance that no longer separates the two
// states is a check that has quietly stopped checking.
//
// ⚠ REACT'S OWN NESTING WARNING IS USELESS HERE, AND THIS WAS TESTED.
// The obvious check is "did React log validateDOMNesting?". Run against the
// known-broken page it logged NOTHING and the check passed — a green tick on
// a page that was visibly wrong. It is therefore not a check in this file at
// all; the structural assertion is `thead tr tr` counted straight off the DOM,
// which did catch it. A check that passes on known-broken code is worse than
// no check, because it manufactures confidence.
//
// Prereqs:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-levels-table.sql
//   cd SwimSyncAdmin && npm run dev -- -p 3100
// Run:
//   ADMIN_URL=http://localhost:3100 node drivers/verify-levels-table.mjs
//
// Admin-only — no Expo server, so nothing here contends for port 8081.

import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const TOLERANCE = 2; // px — see CALIBRATION above
const EXPECTED_HEADERS = ["Order", "Level", "Skills", "Students", "Actions"];

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
};

const { browser, page } = await launch();

// React reports invalid table nesting through console.error in DEVELOPMENT
// only. Against a production build this list is always empty, so it is a
// bonus signal — the geometry above is the actual proof.
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

try {
  console.log("\n1. Load the Levels page as the tenant admin");
  await loginAdmin(page, "coach@swimsync.test");
  await page.goto(`${ADMIN}/levels`, { waitUntil: "networkidle" });
  await page.waitForSelector("tbody tr", { timeout: 15000 });
  // A webfont landing between layout and measurement is the likeliest source
  // of drift in every number below.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const shape = await page.evaluate(() => {
    const table = document.querySelector("table");
    const ths = [...table.querySelectorAll("thead th")];
    const firstDataRow = [...table.querySelectorAll("tbody tr")].find(
      (tr) => tr.querySelectorAll("td").length > 1
    );
    const tds = [...firstDataRow.querySelectorAll("td")];
    return {
      headerTexts: ths.map((t) => t.innerText.trim()),
      thCount: ths.length,
      tdCount: tds.length,
      nestedTrInThead: table.querySelectorAll("thead tr tr").length,
      cols: ths.map((th, i) => ({
        header: th.innerText.trim(),
        thLeft: Math.round(th.getBoundingClientRect().left),
        tdLeft: tds[i] ? Math.round(tds[i].getBoundingClientRect().left) : null,
      })),
    };
  });

  console.log("\n2. Structure");
  check(
    "the header row is not nested inside another row",
    shape.nestedTrInThead === 0,
    `found ${shape.nestedTrInThead} <tr> inside <thead> <tr>`
  );
  check("five header cells", shape.thCount === 5, `got ${shape.thCount}`);
  check(
    "the first data row has the same number of cells as the header",
    shape.tdCount === shape.thCount,
    `header ${shape.thCount} vs row ${shape.tdCount}`
  );
  // Case-insensitive: the headers carry Tailwind's `uppercase`, and innerText
  // returns TRANSFORMED text — an exact-case match would be testing the
  // stylesheet, not the markup.
  check(
    `headers read ${EXPECTED_HEADERS.join(" · ")}`,
    shape.headerTexts.join("|").toLowerCase() ===
      EXPECTED_HEADERS.join("|").toLowerCase(),
    `got ${JSON.stringify(shape.headerTexts)}`
  );

  console.log("\n3. Geometry — every header sits above its own data");
  let worst = 0;
  for (const c of shape.cols) {
    if (c.tdLeft === null) continue;
    const delta = Math.abs(c.thLeft - c.tdLeft);
    worst = Math.max(worst, delta);
    check(
      `"${c.header}" aligns with its column (Δ ${delta}px)`,
      delta <= TOLERANCE,
      `header left ${c.thLeft}px, data left ${c.tdLeft}px`
    );
  }
  console.log(`  → worst offset across all columns: ${worst}px (tolerance ${TOLERANCE}px)`);

  console.log("\n4. The expanded skills row spans the whole table");
  // Expanded explicitly: an unexpanded row proves nothing about its colSpan,
  // and a colSpan that disagrees with the header count is invisible to the
  // row-1 checks above.
  await page.getByRole("button", { name: /skills? [▸▾]/ }).first().click();
  await page.waitForTimeout(400);
  const span = await page.evaluate(() => {
    const table = document.querySelector("table");
    const wide = [...table.querySelectorAll("tbody tr")]
      .map((tr) => tr.querySelectorAll("td"))
      .find((tds) => tds.length === 1);
    if (!wide) return null;
    return {
      colSpan: wide[0].colSpan,
      cellWidth: Math.round(wide[0].getBoundingClientRect().width),
      tableWidth: Math.round(table.getBoundingClientRect().width),
    };
  });
  check("an expanded skills row is present", span !== null);
  if (span) {
    check("it declares colSpan=5, matching the header count", span.colSpan === 5,
      `got ${span.colSpan}`);
    check(
      `it spans the full table width (${span.cellWidth} vs ${span.tableWidth})`,
      Math.abs(span.cellWidth - span.tableWidth) <= TOLERANCE + 2
    );
  }

  // Reported, never asserted — see the header comment. On the known-broken
  // page React logged nothing at all, so a green here means nothing. Printed
  // only because an unexpected console error is worth a human noticing.
  const nesting = consoleErrors.filter((e) =>
    /validateDOMNesting|cannot appear as a child/i.test(e)
  );
  console.log(
    `\n5. FYI — React nesting warnings seen: ${nesting.length}` +
      ` (not asserted: React stayed silent on the broken page too)`
  );
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
