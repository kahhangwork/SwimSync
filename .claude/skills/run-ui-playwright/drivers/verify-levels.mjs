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
import { launch, loginAdmin, loginExpo, tap, ADMIN } from "./lib.mjs";

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

const { browser, page } = await launch({ headless: true });

try {
  console.log("\n[admin] define the ladder");
  // The seed coach is the tenant admin (a private coach is a tenant of one).
  await loginAdmin(page, "coach@swimsync.test");
  await page.goto(`${ADMIN}/levels`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const empty = await page.evaluate(() => document.body.innerText);
  check(/No levels yet/.test(empty), "a business with no ladder gets an empty state");

  // Added out of order ON PURPOSE: "Dolphin" is created first with order 2.
  // If the page sorted by label, Dolphin would render above Seahorse.
  for (const [label, order] of [["Dolphin", "2"], ["Seahorse", "1"]]) {
    await page.getByRole("button", { name: "Add level" }).click();
    await page.waitForTimeout(600);
    await page.getByPlaceholder("Seahorse").fill(label);
    const orderInput = page.locator('input[inputmode="numeric"]');
    await orderInput.fill(order);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1500);
  }

  const listed = await page.evaluate(() => document.body.innerText);
  check(/Seahorse/.test(listed) && /Dolphin/.test(listed), "both levels were created");
  check(listed.indexOf("Seahorse") < listed.indexOf("Dolphin"),
    "the ladder renders in sort_order, NOT alphabetically",
    `Seahorse@${listed.indexOf("Seahorse")} Dolphin@${listed.indexOf("Dolphin")}`);

  // A business cannot define the same rung twice.
  await page.getByRole("button", { name: "Add level" }).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder("Seahorse").fill("Seahorse");
  await page.locator('input[inputmode="numeric"]').fill("9");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  const dup = await page.evaluate(() => document.body.innerText);
  check(/already have a level called/.test(dup),
    "a duplicate level is refused in English, not as a 23505");
  await page.getByRole("button", { name: "Cancel" }).click();

  console.log("\n[admin] place a student on the ladder");
  await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const selects = page.locator("select");
  const n = await selects.count();
  check(n > 0, "the students table has a level picker", `${n} selects found`);
  // Maya Tan is the 3rd student alphabetically (Ethan, Ethan, Maya, Noah).
  await selects.nth(2).selectOption({ label: "Dolphin" });
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
    check(/Dolphin/.test(roster),
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
    check(/Level[\s\S]{0,20}Dolphin/.test(detail),
      "the parent sees their child's level",
      detail.match(/Level[\s\S]{0,25}/)?.[0]);
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
  await browser.close();
}
