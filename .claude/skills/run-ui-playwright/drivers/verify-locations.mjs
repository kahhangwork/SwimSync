// Drives the per-business Locations page: the admin defines locations, they
// appear in sort_order with their address, a duplicate is refused in English,
// the class form's Location dropdown is populated from them, and removing one
// archives it off the list.
//
// The DB properties are covered by pgTAP (locations.test.sql — RLS, the archive
// guard, cross-tenant, RESTRICT, the sync trigger); the filter/picker DERIVATION
// is covered by unit tests (SwimSyncAdmin/lib/locationOptions.test.ts). This
// driver exists for the parts neither can see: that the page renders, that
// create/duplicate/remove actually work through the modal, and that the class
// form's <select> is wired to the entity (a nested-select §7.28 bug typechecks
// clean and renders an empty dropdown).
//
//   node drivers/verify-locations.mjs
//
// ⚠ HERMETIC. Every location this driver creates carries the PREFIX below, and
// cleanup removes nothing else. The driver's locations are never attached to a
// class, so archiving them always succeeds — it leaves the ladder as it found
// it, and a crashed run self-heals on the next one.
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const PREFIX = "LocDrv ";
const BISHAN = `${PREFIX}Bishan`;
const CLEMENTI = `${PREFIX}Clementi`;

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

// Remove one location by name: the row's Remove button, then the confirm
// dialog's. Both are "Remove"; the dialog renders after the table, so the last
// match is the dialog's.
async function removeLocation(page, name) {
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: "Remove" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Remov/ }).last().click();
  await page.waitForTimeout(1200);
}

// Archive every LocDrv location currently listed. Bounded so a page that stops
// updating fails the run instead of spinning.
async function cleanupOwnLocations(page) {
  await page.goto(`${ADMIN}/locations`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  let removed = 0;
  for (let i = 0; i < 12; i++) {
    const mine = await page.evaluate((p) =>
      Array.from(document.querySelectorAll("td"))
        .map((td) => td.textContent.trim())
        .filter((t) => t.startsWith(p)), PREFIX);
    if (mine.length === 0) return removed;
    await removeLocation(page, mine[0]);
    removed++;
  }
  throw new Error(`cleanup did not converge — ${PREFIX}locations still listed after 12 removals`);
}

async function addLocation(page, name, order, address) {
  await page.getByRole("button", { name: "Add location" }).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder("Bishan Swimming Complex").fill(name);
  if (address) await page.getByPlaceholder(/Bishan Street 14/).fill(address);
  await page.locator('input[inputmode="numeric"]').fill(order);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1500);
}

const { browser, page } = await launch({ headless: true });

try {
  console.log("\n[admin] define locations");
  // The seed coach is the tenant admin (a private coach is a tenant of one).
  await loginAdmin(page, "coach@swimsync.test");

  const swept = await cleanupOwnLocations(page);
  if (swept) console.log(`  (setup) swept ${swept} ${PREFIX}location(s) left by an earlier run`);

  // Added out of order ON PURPOSE: Clementi is created first with order 2. If
  // the page sorted by name, Clementi would render above Bishan — the prefix is
  // shared, so it still sorts before Bishan alphabetically.
  await addLocation(page, CLEMENTI, "2", "2 Clementi Ave 3");
  const refused1 = await page.evaluate(() => document.body.innerText);
  if (/Could not save/.test(refused1)) {
    check(false, `created ${CLEMENTI}`, "save refused — aborting before the open modal blocks later clicks");
    throw new Error("create refused");
  }
  await addLocation(page, BISHAN, "1", "1 Bishan St 14");

  const listed = await page.evaluate(() => document.body.innerText);
  check(listed.includes(BISHAN) && listed.includes(CLEMENTI),
    "both locations were created");
  check(listed.indexOf(BISHAN) < listed.indexOf(CLEMENTI),
    "the list renders in sort_order, NOT alphabetically",
    `${BISHAN}@${listed.indexOf(BISHAN)} ${CLEMENTI}@${listed.indexOf(CLEMENTI)}`);
  check(/1 Bishan St 14/.test(listed),
    "the address is shown under the location name");

  // A business cannot define the same location twice (partial-unique, in English).
  await page.getByRole("button", { name: "Add location" }).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder("Bishan Swimming Complex").fill(BISHAN);
  await page.locator('input[inputmode="numeric"]').fill("9");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  const dup = await page.evaluate(() => document.body.innerText);
  check(/already have a location called/.test(dup),
    "a duplicate location is refused in English, not as a 23505");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(600);

  console.log("\n[admin] the class form's Location dropdown is wired to the entity");
  await page.goto(`${ADMIN}/classes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /New Class/ }).click();
  await page.waitForTimeout(800);
  // The location <select> is the one holding "Choose a location…".
  const locSelect = page.locator("select").filter({ hasText: "Choose a location" });
  const opts = await locSelect.locator("option").allTextContents();
  check(opts.some((o) => o.includes(BISHAN)) && opts.some((o) => o.includes(CLEMENTI)),
    "the class form's Location dropdown lists the business's locations",
    `options seen: ${JSON.stringify(opts)}`);
  // Close the form without saving.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);

  console.log("\n[admin] removing a location archives it off the list");
  await page.goto(`${ADMIN}/locations`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await removeLocation(page, CLEMENTI);
  const afterRemove = await page.evaluate(() => document.body.innerText);
  check(!afterRemove.includes(CLEMENTI) && afterRemove.includes(BISHAN),
    "a removed (archived) location leaves the list; the others stay",
    afterRemove.includes(CLEMENTI) ? "Clementi still listed after remove" : "");

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: "/tmp/locations-error.png" });
  process.exitCode = 1;
} finally {
  // Leave nothing behind — runs even on failure.
  try {
    const left = await cleanupOwnLocations(page);
    console.log(`[teardown] removed ${left} ${PREFIX}location(s)`);
  } catch (e) {
    console.error(`TEARDOWN FAILED — ${PREFIX}locations remain:`, e.message);
    process.exitCode = 1;
  }
  await browser.close();
}
