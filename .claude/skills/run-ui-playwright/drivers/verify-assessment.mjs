// verify-assessment.mjs — the admin Assessment tab.
//
// Fixture: fixtures-assessment.sql   Teardown: fixtures-assessment-teardown.sql
//
// WHAT THIS DRIVER IS ACTUALLY FOR. Assessment is a periodic EVENT: an admin
// tours every class and grades each child. The failure this whole feature
// exists to prevent is a child being SKIPPED because their row of months-old
// grades looks exactly like a row filled in this morning. Almost every check
// below is a way that failure could come back:
//
//   * the stale child's grades must render as STALE, not as done;
//   * an unlevelled child must NOT read as fully assessed (0 of 0 is vacuously
//     complete, and that is the highest-blast-radius bug this feature can have);
//   * a promotion must be offered only off THIS round's grades.
//
// ⚠ IT RUNS AT A MOBILE VIEWPORT (390x844), AND THAT IS A CHECK, NOT A SETTING.
// Production's one real assessor is a private coach who grades poolside on a
// phone. Their previous surface was the mobile app, which this release makes
// read-only. If the replacement is unusable at phone width the feature has
// regressed the only person who uses it — and no unit test can see that. The
// grid must scroll INSIDE its container; the PAGE must not scroll sideways.
//
// Logs in as coach@swimsync.test — the tenant admin. NOT superadmin@, which is
// the cross-tenant platform admin and is refused every tenant page.

import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const STALE = "Assess Stale Child";
const FRESH = "Assess Fresh Child";
const SECOND = "Assess Second Level Child";
const UNLEVELLED = "Assess Unlevelled Child";

const { browser, ctx, page } = await launch({ headless: true });
// ⚠ Phone width. See the header — this is the check, not a convenience.
await ctx.setViewportSize?.({ width: 390, height: 844 });
await page.setViewportSize({ width: 390, height: 844 });

try {
  await loginAdmin(page, "coach@swimsync.test", "password123");

  // ── 1. The tab exists and is reachable ────────────────────────────────────
  await page.goto(`${ADMIN}/assessment`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  let text = await page.evaluate(() => document.body.innerText);

  check("the Assessment index renders", /Assessment/i.test(text));
  check(
    "the index offers an 'Assessing since' round start",
    /Assessing since/i.test(text)
  );
  check(
    "the seed's active class is listed",
    /Saturday Beginners/i.test(text),
    text.slice(0, 200).replace(/\n/g, " | ")
  );

  // The four fixture children are on that class; three of four are unassessed
  // for this round (the fresh child has 1 of 2), so the class cannot read done.
  check(
    "the class is NOT reported as fully assessed",
    !/4 of 4 assessed/.test(text),
    text.match(/\d+ of \d+ assessed/)?.[0] ?? "(no count found)"
  );

  // ⚠ THE HIGHEST-VALUE CHECK ON THE INDEX. The unlevelled child is counted
  // apart — not folded into done, and not silently into outstanding either.
  check(
    "children with no level are surfaced as needing one",
    /need a level/i.test(text),
    text.match(/\d+ need a level/)?.[0] ?? "(not surfaced)"
  );

  // ── 2. Into the class grid ────────────────────────────────────────────────
  await page.getByRole("link", { name: "Saturday Beginners", exact: true }).click();
  await page.waitForTimeout(2000);
  text = await page.evaluate(() => document.body.innerText);

  // The round date must survive the navigation, or a multi-day round resets to
  // today the moment the assessor opens the second class.
  check(
    "the round date is carried into the class URL",
    /[?&]since=\d{4}-\d{2}-\d{2}/.test(page.url()),
    page.url()
  );

  check("the grid renders both fixture levels",
    /Assess Water Confidence/.test(text) && /Assess Front Crawl/.test(text));

  // A class carries no level of its own, so the grid MUST split. One flat
  // matrix would show every skill against every child.
  check(
    "children are grouped under their own level, not one flat matrix",
    /Assess Water Confidence[\s\S]*Assess Stale Child/.test(text) &&
      /Assess Front Crawl[\s\S]*Assess Second Level Child/.test(text)
  );

  check("the 'No level set' group exists for the unlevelled child",
    /No level set/i.test(text) && text.includes(UNLEVELLED));

  // ── 3. ⚠ THE ROUND. Stale must not read as done ───────────────────────────
  // The stale child holds the TOP grade on BOTH skills, 90 days ago. If
  // freshness were ignored they would read 2/2 done. They must read 0/2.
  const staleRow = page.locator("tr", { hasText: STALE }).first();
  const staleText = (await staleRow.innerText()).replace(/\n/g, " ");

  check(
    "a child graded 90 days ago counts ZERO for this round",
    /\b0\/2\b/.test(staleText),
    staleText
  );
  check(
    "their stale grades still show, dated, rather than vanishing",
    /\d{1,2}\s+\w{3}/.test(staleText),
    staleText
  );

  // ⚠ AND NO PROMOTION. Every skill is at the top grade, so a promotion check
  // that ignored freshness would offer to move a child nobody has looked at.
  check(
    "no promotion is offered off a PREVIOUS round's top grades",
    !/Move up/i.test(staleText),
    staleText
  );

  // The fresh child, graded today on one of two skills.
  const freshRow = page.locator("tr", { hasText: FRESH }).first();
  const freshText = (await freshRow.innerText()).replace(/\n/g, " ");
  check("a child graded today counts toward this round", /\b1\/2\b/.test(freshText), freshText);

  // ── 4. ⚠ THE VACUITY GUARD ────────────────────────────────────────────────
  // 0 of 0 is vacuously complete. If this ever reads as assessed, the tool
  // tells the assessor to skip the one child who most needs attention.
  const unlevelledRow = page.locator("tr", { hasText: UNLEVELLED }).first();
  const unlevelledText = (await unlevelledRow.innerText()).replace(/\n/g, " ");
  check(
    "an unlevelled child is NOT reported as assessed",
    /Needs a level/i.test(unlevelledText) && !/0\/0/.test(unlevelledText),
    unlevelledText
  );
  check(
    "an unlevelled child is never offered a promotion",
    !/Move up/i.test(unlevelledText),
    unlevelledText
  );

  // ── 5. Grading actually writes — cycle ────────────────────────────────────
  const before = (await page.locator("tr", { hasText: SECOND }).first().innerText())
    .replace(/\n/g, " ");
  const secondCell = page
    .locator("tr", { hasText: SECOND })
    .first()
    .getByRole("button")
    .first();
  await secondCell.click();
  await page.waitForTimeout(1200);
  const afterCycle = (await page.locator("tr", { hasText: SECOND }).first().innerText())
    .replace(/\n/g, " ");

  check(
    "clicking a cell records a grade (cycle)",
    before !== afterCycle && /\b1\/2\b/.test(afterCycle),
    `${before}  ->  ${afterCycle}`
  );

  // It must SURVIVE a reload — an optimistic UI that never persisted would
  // look identical until the page is re-read.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const afterReload = (await page.locator("tr", { hasText: SECOND }).first().innerText())
    .replace(/\n/g, " ");
  check(
    "the grade survived a reload — it really reached the database",
    /\b1\/2\b/.test(afterReload),
    afterReload
  );

  // ── 6. Paint mode ─────────────────────────────────────────────────────────
  const paintSwatch = page.getByRole("button", { name: "Mastered", exact: true });
  const hasPaint = (await paintSwatch.count()) > 0;
  check("a paint toolbar is offered", hasPaint);

  if (hasPaint) {
    await paintSwatch.first().click();
    await page.waitForTimeout(400);
    const armedText = await page.evaluate(() => document.body.innerText);
    // An armed mode the assessor cannot see is how a confident click writes the
    // wrong record.
    check(
      "the armed grade is announced loudly",
      /Painting/i.test(armedText),
      armedText.match(/Painting[^\n]*/)?.[0] ?? ""
    );

    // "All <grade>" paints a whole row as ONE stroke — the array upsert path.
    //
    // ⚠ PAINTED ONTO THE *STALE* CHILD ON PURPOSE, and this is the sharpest
    // check in the file. That child already held the TOP grade on both skills
    // 90 days ago, and was refused a promotion above. Re-confirming those same
    // grades today changes NOTHING except graded_at — so if the promotion now
    // appears, freshness is provably the deciding factor and not a side effect
    // of the grade values.
    //
    // It also exercises the migration's whole reason for existing: re-confirming
    // an UNCHANGED grade must advance graded_at. Under the old trigger the write
    // would succeed and the row would still read 0/2, because the stamp only
    // fired when the grade changed.
    //
    // (The second-level child cannot be used here: Front Crawl is the highest
    // fixture rung, so nextLevel() is correctly null and no promotion is due.)
    const allBtn = page
      .locator("tr", { hasText: STALE })
      .first()
      .getByRole("button", { name: /^All / });
    if ((await allBtn.count()) > 0) {
      await allBtn.first().click();
      // Longer than STROKE_IDLE_MS (350ms) so the stroke has flushed.
      await page.waitForTimeout(2500);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      const painted = (await page.locator("tr", { hasText: STALE }).first().innerText())
        .replace(/\n/g, " ");
      check(
        "painting a whole row persists every cell in one stroke",
        /\b2\/2\b/.test(painted),
        painted
      );
      // ⚠ RE-CONFIRMING AN UNCHANGED GRADE MUST COUNT FOR THIS ROUND. This is
      // the assertion that fails against the pre-20260829000100 trigger.
      check(
        "re-confirming an unchanged grade makes it count for this round",
        !/0\/2/.test(painted),
        painted
      );
      check(
        "a child mastered THIS round IS offered the next level",
        /Move up/i.test(painted),
        painted
      );
    } else {
      check("painting a whole row persists every cell in one stroke", false,
        "the 'All <grade>' button was not found");
    }

    // Esc must disarm — a mode you cannot leave is a mode that mis-records.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const disarmed = await page.evaluate(() => document.body.innerText);
    check("Escape disarms paint mode", !/Painting/i.test(disarmed));
  }

  // ── 7. ⚠ MOBILE GEOMETRY ──────────────────────────────────────────────────
  // The grid scrolls inside its own container; the PAGE must not scroll
  // sideways at phone width, or the assessor loses the child-name column.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check(
    "the page does not scroll sideways at 390px",
    overflow <= 2,
    `horizontal overflow: ${overflow}px`
  );

  await page.screenshot({ path: "/tmp/assessment-grid-mobile.png", fullPage: true });
  console.log("screenshot: /tmp/assessment-grid-mobile.png");

  // ── 8. The single-child drawer on the Students page ───────────────────────
  await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const actions = page
    .locator("tr", { hasText: STALE })
    .first()
    .getByRole("button", { name: "Actions", exact: true });
  if ((await actions.count()) > 0) {
    await actions.first().click();
    await page.waitForTimeout(800);
    const drawer = await page.evaluate(() => document.body.innerText);
    check("the Students drawer offers 'Grade skills'", /Grade skills/i.test(drawer));

    await page.getByRole("button", { name: "Grade skills", exact: true }).click();
    await page.waitForTimeout(2500);
    const modal = await page.evaluate(() => document.body.innerText);
    check(
      "the drawer's grading modal shows that child's skills",
      /Assess Float unaided/i.test(modal),
      modal.slice(0, 200).replace(/\n/g, " | ")
    );
    // The one-off surface has no run of children to paint across.
    check(
      "the single-child modal offers no paint toolbar",
      !/Painting/i.test(modal) && !/^Paint:/m.test(modal)
    );
  } else {
    check("the Students drawer offers 'Grade skills'", false, "no Actions button found");
  }
} catch (err) {
  check("driver ran to completion", false, String(err));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  if (passed !== results.length) process.exitCode = 1;
}
