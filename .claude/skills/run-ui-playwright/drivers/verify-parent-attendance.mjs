// Parent Attendance screen: chip layout + the "not assigned yet" state.
//
// Guards two web-only regressions that unit tests cannot catch:
//  1. react-native-web gives EVERY ScrollView flexGrow:1, so a horizontal one
//     expands to fill the column's leftover height and its row content container
//     (alignItems: stretch by default) stretches each chip to that height. The
//     chips rendered as ~180px tall capsules on web while looking fine on native.
//  2. An unassigned child showed "No records found", which reads as broken;
//     PRD §5.1 requires a "not assigned yet" state until the admin assigns.
//
// Setup (from repo root):
//   supabase db reset
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-unmarked-lessons.sql
//   cd SwimSyncApp && npx expo start --web   # :8081
//
// The fixture gives parent@swimsync.test three children: Ana + Ben (assigned,
// 4 Jul marked) and Julia (unassigned).
//
// GOTCHA: the previous screen stays mounted under the stack, and the home screen
// renders its own "admin will assign your child soon" copy — assert only on
// strings unique to this screen, or you get false passes.
import os from "node:os";
import path from "node:path";
import { launch, loginExpo, tap, dumpText } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const { browser } = await launch();
const ctx = await browser.newContext({
  viewport: { width: 420, height: 900 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "Asia/Singapore",
});
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());

await loginExpo(page, "parent@swimsync.test", "password123");
await page.waitForTimeout(3000);

// Navigate like a user (deep-linking into a nested stack is unreliable on Expo web).
await tap(page.locator('a[href="/attendance"]').first(), "Attendance tab");
await page.waitForTimeout(3500);

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// --- chip geometry: the actual bug ---
async function chipBox(name) {
  const el = page.getByText(name, { exact: true }).first();
  return await el.evaluate((n) => {
    // climb to the touchable (the pill), not the inner text node
    let e = n;
    for (let i = 0; i < 3 && e.parentElement; i++) {
      e = e.parentElement;
      const r = e.getBoundingClientRect();
      if (r.height > 0 && e.className && String(e.className).includes("rounded")) break;
    }
    const r = e.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width) };
  });
}

const all = await chipBox("All");
const present = await chipBox("Present");
console.log("chip boxes:", { all, present });
// A correct filter chip is roughly text-height + padding: ~28-44px. Pre-fix it was ~180.
check("'All' chip is a normal chip height, not a tall capsule", all.h > 0 && all.h < 60, `${all.h}px`);
check("'Present' chip is a normal chip height", present.h > 0 && present.h < 60, `${present.h}px`);
check("chip is wider than tall (pill, not capsule)", all.w > all.h);

// --- "not assigned yet" state ---
// The screen defaults to the FIRST child (Ana, assigned), so select Julia explicitly.
// NOTE: assert only on strings unique to THIS screen — the home screen stays mounted
// under the stack and renders its own "admin will assign your child soon" copy.
await tap(page.getByText("Julia", { exact: true }).first(), "Julia chip");
await page.waitForTimeout(2500);
let text = await dumpText(page);
await page.screenshot({ path: `${SHOT}/attendance-unassigned.png`, fullPage: true });
check("Unassigned child shows the not-assigned state", /isn't in a class yet|isn’t in a class yet/.test(text));
check("Does NOT say the misleading 'No records found'", !/No records found/.test(text));
check("Does NOT show another child's lessons while unassigned selected", !/Saturday Beginners/.test(text));

// --- switch to an assigned child with records ---
await tap(page.getByText("Ana", { exact: true }).first(), "Ana chip");
await page.waitForTimeout(3000);
text = await dumpText(page);
await page.screenshot({ path: `${SHOT}/attendance-assigned.png`, fullPage: true });
check("Assigned child shows real lesson records", /Saturday Beginners/.test(text));
check("Assigned child does NOT show the unassigned state", !/isn't in a class yet|isn’t in a class yet/.test(text));

// --- filter with no matches (records exist, none absent) ---
await tap(page.getByText("Absent", { exact: true }).first(), "Absent filter");
await page.waitForTimeout(1500);
text = await dumpText(page);
await page.screenshot({ path: `${SHOT}/attendance-filter-empty.png`, fullPage: true });
check("Empty filter result names the filter", /No absent lessons/.test(text));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
process.exit(failed ? 1 : 0);
