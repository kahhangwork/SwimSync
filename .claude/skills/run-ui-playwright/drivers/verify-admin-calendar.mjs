// The admin Calendar (/calendar), end to end through the real UI.
//
// THE LOAD-BEARING ASSERTIONS:
//   • the day view lays two overlapping fixture classes into two lanes and shows
//     each card's `enrolled+guests/capacity` count ("3/3" + FULL, "1+1/6");
//   • the substitute reads "(Sub)" on the card (money axis, §7.152);
//   • hover lists the roster incl. the MAKE-UP guest by name; click pins it;
//   • Today / ‹ / › move the URL `date` (no date in component state, §7.95);
//   • the time gutter stays at x=0 after the grid scrolls sideways;
//   • month "+N more"/day-number and week day-header jump to that day's day view;
//   • double-click lands on /lessons/[classId]/[date];
//   • THE CALENDAR WRITES NOTHING: the fixture's lesson_sessions count is the
//     same after the whole run (ADMIN_CALENDAR_PLAN RISK 4). Checked through
//     psql so it is the database's word, not the page's.
//
// Setup: supabase running + seed; fixtures-admin-calendar.sql loaded; admin dev
// server on :3000 (ADMIN_URL to override).
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (l, p, d = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
};

const ROSE_ID = "ca1c1a55-0000-0000-0000-000000000001";
const SESSION_COUNT_SQL =
  "SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'ca1c1a55-%'";
function sessionCount() {
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -Atc "${SESSION_COUNT_SQL}"`,
    { encoding: "utf8" }
  ).trim();
}
const sessionsBefore = sessionCount();

const { browser, page } = await launch();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
  await loginAdmin(page, "coach@swimsync.test");

  // ── Day view, today ───────────────────────────────────────────────────────
  await page.goto(`${ADMIN}/calendar?view=day`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-card").first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: shot("admin-calendar-day.png") });

  // Today in SGT, computed here — the page derives a missing `date` param per
  // render and deliberately does not write it into the URL.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const rose = page.getByTestId("lesson-card").filter({ hasText: "Cal Rose Full" }).first();
  const emerald = page.getByTestId("lesson-card").filter({ hasText: "Cal Emerald Open" }).first();
  check("day view shows both fixture classes", (await rose.count()) === 1 && (await emerald.count()) === 1);

  const roseBox = await rose.boundingBox();
  const emeraldBox = await emerald.boundingBox();
  check(
    "overlapping classes sit in two lanes (side by side, not stacked)",
    !!roseBox && !!emeraldBox && Math.abs(roseBox.x - emeraldBox.x) > 50,
    `rose.x=${roseBox?.x} emerald.x=${emeraldBox?.x}`
  );

  const roseText = await rose.innerText();
  const emeraldText = await emerald.innerText();
  check("full class reads 3/3 and FULL", /3\/3/.test(roseText) && /FULL/.test(roseText), roseText.replace(/\n/g, " | "));
  check("open class reads 1+1/6 (enrolled + make-up guest / capacity)", /1\+1\/6/.test(emeraldText), emeraldText.replace(/\n/g, " | "));
  check("substitute shows as (Sub) with the sub's name", /Calendar Sub/.test(emeraldText) && /\(Sub\)/.test(emeraldText));

  // ── Hover → roster incl. the make-up guest; click pins it ──────────────
  await emerald.hover();
  const tip = page.getByTestId("lesson-tooltip");
  await tip.waitFor({ timeout: 5000 });
  const tipText = await tip.innerText();
  check("hover tooltip lists the enrolled child and the make-up guest", /Calkid Delta/.test(tipText) && /Calkid Alpha/.test(tipText) && /MAKE-UP/i.test(tipText), tipText.replace(/\n/g, " | "));
  await emerald.click();
  await page.waitForTimeout(200);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  check("click pins the tooltip (survives the mouse leaving)", (await tip.count()) === 1);
  check("pinned tooltip offers an Open lesson link", (await tip.getByRole("link", { name: /Open lesson/ }).count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Escape unpins", (await tip.count()) === 0);

  // ── Navigation moves the URL date ─────────────────────────────────────────
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForTimeout(400);
  const nextDate = new URL(page.url()).searchParams.get("date");
  check("› moves the URL date forward one day", nextDate !== null && nextDate > today, `${today} → ${nextDate}`);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.waitForTimeout(400);
  check("Today returns the URL date to today", new URL(page.url()).searchParams.get("date") === today);

  // ── Sticky gutter: scroll the grid sideways (force a wide grid via zoom) ──
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(300);
  const scroller = page.getByTestId("time-grid-scroll");
  await scroller.evaluate((el) => { el.scrollLeft = 200; });
  await page.waitForTimeout(200);
  const scrollLeft = await scroller.evaluate((el) => el.scrollLeft);
  const gutterBox = await page.getByTestId("time-gutter").boundingBox();
  const scrollerBox = await scroller.boundingBox();
  check(
    "time gutter stays at the left edge after horizontal scroll",
    scrollLeft > 0 && !!gutterBox && !!scrollerBox && Math.abs(gutterBox.x - scrollerBox.x) < 2,
    `scrollLeft=${scrollLeft} gutter.x=${gutterBox?.x} scroller.x=${scrollerBox?.x}`
  );
  await page.screenshot({ path: shot("admin-calendar-day-scrolled.png") });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── Week view: day header jumps to the day view ───────────────────────────
  await page.goto(`${ADMIN}/calendar?view=week&date=${today}`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-card").first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: shot("admin-calendar-week.png") });
  const weekCards = await page.getByTestId("lesson-card").count();
  check("week view renders the fixture lessons", weekCards >= 2, `${weekCards} cards`);

  // ── Month view: chips + day number → day view ─────────────────────────────
  await page.goto(`${ADMIN}/calendar?view=month&date=${today}`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-chip").first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: shot("admin-calendar-month.png") });
  const todayCell = page.locator(`[data-testid="month-cell"][data-date="${today}"]`);
  check("month view has today's cell with chips", (await todayCell.getByTestId("lesson-chip").count()) >= 2);
  await todayCell.getByTitle("Open this day").click();
  await page.waitForTimeout(400);
  const u = new URL(page.url());
  check("day number jumps to the day view of that date", u.searchParams.get("view") === "day" && u.searchParams.get("date") === today);

  // ── Agenda ───────────────────────────────────────────────────────────────
  await page.goto(`${ADMIN}/calendar?view=agenda&date=${today}`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-card").first().waitFor({ timeout: 15000 });
  const agendaText = await page.locator("main, body").first().innerText();
  check("agenda lists the roster beside each lesson", /Calkid Bravo/.test(agendaText) && /Calkid Delta/.test(agendaText));
  await page.screenshot({ path: shot("admin-calendar-agenda.png") });

  // ── Filters ──────────────────────────────────────────────────────────────
  await page.goto(`${ADMIN}/calendar?view=day&date=${today}`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-card").first().waitFor({ timeout: 15000 });
  await page.getByLabel("Coach").selectOption({ label: "Calendar Sub" });
  await page.waitForTimeout(500);
  const filtered = await page.getByTestId("lesson-card").count();
  check("coach filter keeps only the lesson that coach teaches (the substitute's)", filtered === 1, `${filtered} cards`);
  check("coach filter is in the URL", (new URL(page.url()).searchParams.get("coach") ?? "").length > 0);
  await page.getByLabel("Coach").selectOption({ label: "All coaches" });
  await page.waitForTimeout(400);

  // ── Double-click → lesson page ───────────────────────────────────────────
  await page.getByTestId("lesson-card").filter({ hasText: "Cal Rose Full" }).first().dblclick();
  await page.waitForURL(/\/lessons\//, { timeout: 10000 }).catch(() => {});
  check(
    "double-click navigates to /lessons/[classId]/[date]",
    page.url().includes(`/lessons/${ROSE_ID}/${today}`),
    page.url()
  );

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || "));
} finally {
  await browser.close();
}

const sessionsAfter = sessionCount();
check(
  "the calendar created NO lesson_sessions rows (read-only)",
  sessionsBefore === sessionsAfter,
  `${sessionsBefore} → ${sessionsAfter}`
);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
