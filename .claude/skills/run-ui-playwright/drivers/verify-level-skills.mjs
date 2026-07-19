// Drives level skills: the admin enters a curriculum, the coach and parent read it.
//
// Uses REAL curriculum text from the user's own level table (Toddler 1), because
// the properties that matter are order-preservation and that a progression note
// ("Progress to B3 upon completing T4") has somewhere to live that is not a
// fake skill row.
//
//   docker exec ... < drivers/fixtures-student-identity.sql
//   node drivers/verify-level-skills.mjs
import { launch, loginAdmin, loginExpo, tap, ADMIN } from "./lib.mjs";

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

// Deliberately NOT alphabetical — "Rules of the pool" would sort first.
const SKILLS = ["Aeroplane Kick", "Basic bubbles", "Rules of the pool"];
const NOTE = "Progress to B3 upon completing T4";

const { browser, page } = await launch({ headless: true });

try {
  console.log("\n[admin] enter a curriculum");
  await loginAdmin(page, "coach@swimsync.test");
  await page.goto(`${ADMIN}/levels`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // A level to hang the curriculum on, carrying the progression note.
  await page.getByRole("button", { name: "Add level" }).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder("Seahorse").fill("Toddler 1");
  await page.locator('input[inputmode="numeric"]').fill("1");
  await page.getByPlaceholder("Progress to B3 upon completing T4").fill(NOTE);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1800);

  const listed = await page.evaluate(() => document.body.innerText);
  check(/Toddler 1/.test(listed), "the level was created");
  check(new RegExp(NOTE).test(listed),
    "a progression note lives on the level, not as a fake skill");

  // Expand and add the skills in teaching order.
  // exact:true throughout — the expand link ("Add skills \u25b8") and the submit
  // button ("Add skill") collide under a substring match, the same family as
  // getByText("Edit") matching "Credit Balance" (SKILL.md gotcha 7).
  await page.getByRole("button", { name: /^Add skills/ }).first().click();
  await page.waitForTimeout(800);
  for (const skill of SKILLS) {
    await page.getByPlaceholder("Aeroplane Kick").fill(skill);
    await page.getByRole("button", { name: "Add skill", exact: true }).click();
    await page.waitForTimeout(1400);
  }

  const withSkills = await page.evaluate(() => document.body.innerText);
  check(SKILLS.every((s) => withSkills.includes(s)), "all three skills were added");
  check(/3 skills/.test(withSkills), "the level reports its skill count");

  // ORDER IS THE POINT. Alphabetically "Aeroplane Kick" < "Basic bubbles" <
  // "Rules of the pool" happens to match, so assert the REVERSE case too by
  // moving the last skill to the top.
  const idxA = withSkills.indexOf("Aeroplane Kick");
  const idxR = withSkills.indexOf("Rules of the pool");
  check(idxA < idxR, "skills render in teaching order");

  // Duplicate, ignoring case/whitespace.
  await page.getByPlaceholder("Aeroplane Kick").fill("  aeroplane kick  ");
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  await page.waitForTimeout(1400);
  const dup = await page.evaluate(() => document.body.innerText);
  check(/already listed at this level/.test(dup),
    "the same skill twice at one level is refused, in English",
    dup.match(/".*?" is already[^\n]*/)?.[0]);

  // Reorder: move "Rules of the pool" up, and confirm it PERSISTS (two writes).
  await page.getByLabel("Move up").last().click();
  await page.waitForTimeout(1800);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^\d+ skills?/ }).first().click();
  await page.waitForTimeout(800);
  const reordered = await page.evaluate(() => document.body.innerText);
  check(reordered.indexOf("Rules of the pool") < reordered.indexOf("Basic bubbles"),
    "reordering persists across a reload — not just local state");

  // Place a student on the level so the app screens have something to show.
  await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.locator("select").nth(2).selectOption({ label: "Toddler 1" });
  await page.waitForTimeout(2000);

  console.log("\n[coach] the curriculum is available poolside");
  const mob = await launch({ mobile: true, headless: true });
  try {
    await loginExpo(mob.page, "coach@swimsync.test");
    await tap(mob.page.getByText("Classes").last(), "Classes");
    await mob.page.waitForTimeout(2000);
    await tap(mob.page.getByText("View Roster & Sessions").first(), "View Roster");
    await mob.page.waitForTimeout(3000);

    const collapsed = await mob.page.evaluate(() => document.body.innerText);
    check(/What Toddler 1 covers/.test(collapsed),
      "the roster offers the curriculum without showing it");
    check(!/Basic bubbles/.test(collapsed),
      "it is COLLAPSED by default — a roster is not thirty lines of skills");

    await tap(mob.page.getByText("What Toddler 1 covers"), "expand curriculum");
    await mob.page.waitForTimeout(1200);
    const opened = await mob.page.evaluate(() => document.body.innerText);
    check(SKILLS.every((s) => opened.includes(s)),
      "tapping shows the full curriculum",
      opened.match(/Toddler 1[\s\S]{0,120}/)?.[0]);

    console.log("\n[parent] what is my child working towards");
    await mob.page.evaluate(() => window.localStorage.clear());
    await mob.page.goto("http://localhost:8081/login", { waitUntil: "domcontentloaded" });
    await mob.page.waitForTimeout(2500);
    await loginExpo(mob.page, "identity@test.local");
    await tap(mob.page.getByText("Maya Tan").first(), "Maya Tan");
    await mob.page.waitForTimeout(3000);

    const detail = await mob.page.evaluate(() => document.body.innerText);
    check(/Date of Birth/.test(detail), "on the child detail screen");
    check(SKILLS.every((s) => detail.includes(s)),
      "the parent sees the whole curriculum for their child's level");
    check(new RegExp(NOTE).test(detail), "and the progression note");
    check(detail.indexOf("Rules of the pool") < detail.indexOf("Basic bubbles"),
      "in the admin's order, not alphabetical or insertion order");
  } finally {
    await mob.browser.close();
  }

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: "/tmp/skills-error.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
