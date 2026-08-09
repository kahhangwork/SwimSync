// Drives per-business swimming levels: the admin defines a ladder, places a
// student on it, and the coach + parent see the label.
//
// The tenant properties are covered by pgTAP (tenant_levels.test.sql); this
// exists for the parts pgTAP cannot see — that the ladder renders in
// sort_order rather than alphabetically, and that the label actually reaches
// the coach's roster and the parent's child detail through nested selects,
// which is where §7.28 bugs typecheck cleanly and render nothing.
//
//   docker exec ... < drivers/fixtures-student-identity.sql
//   node drivers/verify-levels.mjs
//
// ⚠ HERMETIC SINCE 2026-08-09, AND IT WAS NOT BEFORE. Check 1 asserts the
// business has NO ladder, then the driver builds one — so a second run in the
// same day used to fail on the first run's data. It failed badly: the create
// hit "you already have a level called…", the modal stayed open, and its
// backdrop then intercepted every later click until a 30s timeout killed the
// run. One check reported, eight never ran, exit 1 for the wrong reason.
//
// The fix is structural, not a note: the driver REMOVES ITS OWN LEVELS through
// the admin UI before check 1 and again on exit, so the empty state it asserts
// is one it created. There is no SQL teardown to remember, and a crashed run
// self-heals on the next one.
//
// ⚠ IT MUST NEVER DELETE A LEVEL IT DID NOT CREATE. tenant_levels is shared
// with fixtures-levels-table.sql ('LvlTbl ') on this same tenant, and
// students.level_id is ON DELETE SET NULL (§7.69) — an unscoped delete blanks
// real children's levels silently, recording nothing. Hence the prefix below:
// cleanup is scoped to it, and foreign levels make this driver FAIL and say so
// rather than tidy them away.
import { launch, loginAdmin, loginExpo, tap, ADMIN } from "./lib.mjs";

// Every level this driver creates carries this prefix, and cleanup deletes
// nothing else. Distinct from fixtures-levels-table.sql's 'LvlTbl '.
const PREFIX = "LvlDrv ";
const SEAHORSE = `${PREFIX}Seahorse`;
const DOLPHIN = `${PREFIX}Dolphin`;

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

// Remove one level by label: the row's Remove button, then the confirm
// dialog's. Both are called "Remove"; the dialog renders after the table, so
// the last match is the dialog's.
async function removeLevel(page, label) {
  const row = page.getByRole("row").filter({ hasText: label });
  await row.getByRole("button", { name: "Remove" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Remov/ }).last().click();
  await page.waitForTimeout(1200);
}

// Delete every LvlDrv level currently on the ladder. Returns how many went.
// Bounded, so a page that stops updating fails the run instead of spinning.
async function cleanupOwnLevels(page) {
  await page.goto(`${ADMIN}/levels`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  let removed = 0;
  for (let i = 0; i < 12; i++) {
    const mine = await page.evaluate((p) =>
      Array.from(document.querySelectorAll("td"))
        .map((td) => td.textContent.trim())
        .filter((t) => t.startsWith(p)), PREFIX);
    if (mine.length === 0) return removed;
    await removeLevel(page, mine[0]);
    removed++;
  }
  throw new Error(`cleanup did not converge — ${PREFIX}levels still on the ladder after 12 removals`);
}

const { browser, page } = await launch({ headless: true });

try {
  console.log("\n[admin] define the ladder");
  // The seed coach is the tenant admin (a private coach is a tenant of one).
  await loginAdmin(page, "coach@swimsync.test");

  // Setup: clear this driver's own leftovers, so the empty state below is one
  // we created rather than one we hope to inherit.
  const swept = await cleanupOwnLevels(page);
  if (swept) console.log(`  (setup) swept ${swept} ${PREFIX}level(s) left by an earlier run`);

  const empty = await page.evaluate(() => document.body.innerText);
  check(/No levels yet/.test(empty), "a business with no ladder gets an empty state",
    `the ladder is NOT empty after sweeping this driver's own ${PREFIX}levels, so what remains ` +
    `belongs to another fixture (fixtures-levels-table.sql seeds 'LvlTbl ' on this same tenant). ` +
    `This driver deliberately will NOT delete it — students.level_id is ON DELETE SET NULL and the ` +
    `blanking is silent (§7.69). Tear that fixture down, or supabase db reset.`);

  // Added out of order ON PURPOSE: Dolphin is created first with order 2. If
  // the page sorted by label, Dolphin would render above Seahorse — the prefix
  // is shared, so it still sorts before Seahorse alphabetically.
  for (const [label, order] of [[DOLPHIN, "2"], [SEAHORSE, "1"]]) {
    await page.getByRole("button", { name: "Add level" }).click();
    await page.waitForTimeout(600);
    await page.getByPlaceholder("Seahorse").fill(label);
    const orderInput = page.locator('input[inputmode="numeric"]');
    await orderInput.fill(order);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1500);

    // A refused save leaves the modal OPEN, and its backdrop then intercepts
    // every later click — the 30s timeout that used to end this driver with
    // one check reported. Fail here instead, naming the reason.
    const afterSave = await page.evaluate(() => document.body.innerText);
    const refused = afterSave.match(/(You already have a level called[^\n]*|Could not save[^\n]*)/)?.[0];
    if (refused) {
      check(false, `created ${label}`, refused);
      throw new Error(`create refused for ${label} — aborting before the open modal blocks every later click`);
    }
  }

  const listed = await page.evaluate(() => document.body.innerText);
  check(listed.includes(SEAHORSE) && listed.includes(DOLPHIN),
    "both levels were created",
    "matched on the PREFIXED labels — a bare /Seahorse/ would also match a " +
    "stranger's rung and report this driver's own creates as fine");
  check(listed.indexOf(SEAHORSE) < listed.indexOf(DOLPHIN),
    "the ladder renders in sort_order, NOT alphabetically",
    `${SEAHORSE}@${listed.indexOf(SEAHORSE)} ${DOLPHIN}@${listed.indexOf(DOLPHIN)}`);

  // A business cannot define the same rung twice.
  await page.getByRole("button", { name: "Add level" }).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder("Seahorse").fill(SEAHORSE);
  await page.locator('input[inputmode="numeric"]').fill("9");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  const dup = await page.evaluate(() => document.body.innerText);
  check(/already have a level called/.test(dup),
    "a duplicate level is refused in English, not as a 23505");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(600);

  console.log("\n[admin] place a student on the ladder");
  await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // ⚠ SELECT MAYA'S ROW BY NAME, NEVER BY POSITION. This was
  // `page.locator("select").nth(2)`, commented "Maya Tan is the 3rd student
  // alphabetically" — true only of the seed. Load any fixture that adds a
  // student sorting before her (fixtures-levels-table.sql seeds three
  // 'LvlTbl Child …' rows) and nth(2) is somebody ELSE'S child: the driver
  // writes its level onto them, and teardown then blanks it via ON DELETE SET
  // NULL, silently (§7.69). Measured 2026-08-09 — LvlTbl children with a level
  // went 3 → 2. A row-scoped locator cannot do that no matter what else is on
  // the page.
  const mayaRow = page.getByRole("row").filter({ hasText: "Maya Tan" });
  const mayaSelect = mayaRow.locator("select");
  check(await mayaSelect.count() === 1,
    "the students table has a level picker on Maya Tan's row",
    `${await mayaSelect.count()} selects found in her row`);
  await mayaSelect.selectOption({ label: DOLPHIN });
  await page.waitForTimeout(2000);

  const placed = await page.evaluate(() => document.body.innerText);
  check(!/Could not update/.test(placed) && !/different business/.test(placed),
    "the level saved without error", placed.match(/Could not[^\n]*/)?.[0]);

  console.log("\n[coach] the roster shows the level");
  const mob = await launch({ mobile: true, headless: true });
  try {
    await loginExpo(mob.page, "coach@swimsync.test");
    await tap(mob.page.getByText("Classes").last(), "Classes");
    await mob.page.waitForTimeout(2000);
    await tap(mob.page.getByText("View Roster & Sessions").first(), "View Roster");
    await mob.page.waitForTimeout(3000);
    const roster = await mob.page.evaluate(() => document.body.innerText);
    check(roster.includes(DOLPHIN),
      "the coach sees the level on their roster",
      roster.match(/Maya Tan[\s\S]{0,60}/)?.[0]);

    console.log("\n[parent] the child detail shows the level, read-only");
    await mob.page.evaluate(() => window.localStorage.clear());
    await mob.page.goto("http://localhost:8081/login", { waitUntil: "domcontentloaded" });
    await mob.page.waitForTimeout(2500);
    await loginExpo(mob.page, "identity@test.local");
    await tap(mob.page.getByText("Maya Tan").first(), "Maya Tan");
    await mob.page.waitForTimeout(3000);
    const detail = await mob.page.evaluate(() => document.body.innerText);
    check(/Date of Birth/.test(detail), "on the child detail screen");
    check(new RegExp(`Level[\\s\\S]{0,20}${DOLPHIN}`).test(detail),
      "the parent sees their child's level",
      detail.match(/Level[\s\S]{0,32}/)?.[0]);
  } finally {
    await mob.browser.close();
  }

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: "/tmp/levels-error.png" });
  process.exitCode = 1;
} finally {
  // Leave nothing behind. Runs even on failure — a crashed run that keeps its
  // levels is what made the NEXT run fail for an unrelated-looking reason.
  // Failing to clean up is itself a failure: leftovers make a sibling's test
  // pass or fail for reasons nobody can see (check-teardowns.sh's argument).
  try {
    const left = await cleanupOwnLevels(page);
    console.log(`[teardown] removed ${left} ${PREFIX}level(s)`);
  } catch (e) {
    console.error(`TEARDOWN FAILED — ${PREFIX}levels remain on the ladder:`, e.message);
    process.exitCode = 1;
  }
  await browser.close();
}
