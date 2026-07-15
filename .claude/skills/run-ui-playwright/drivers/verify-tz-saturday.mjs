// Timezone regression: a coach opening the app at 07:30 SGT on a Saturday.
// Before the fix, the screen listed Saturday's classes (local getDay()) but
// handed the attendance screen Friday's date (toISOString()), writing a
// mis-dated session. Both must now say Saturday.
import { launch, loginExpo, tap, dumpText } from "./lib.mjs";

const SHOT = "/private/tmp/claude-501/-Users-kahhang-Documents-Code-SwimSync/de785498-ea02-48f8-9c73-8d4e1c128c6a/scratchpad";
// 2026-07-18 07:30 SGT == 2026-07-17 23:30 UTC. Friday in UTC, Saturday in SG.
const AT_0730_SGT_SATURDAY = new Date("2026-07-17T23:30:00Z");

const { browser } = await launch();
const ctx = await browser.newContext({
  viewport: { width: 420, height: 900 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "Asia/Singapore",
});
await ctx.clock.install({ time: AT_0730_SGT_SATURDAY });

const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
await loginExpo(page, "coach@swimsync.test", "password123");
await page.waitForTimeout(3500);

const text = await dumpText(page);
await page.screenshot({ path: `${SHOT}/tz-saturday-0730.png`, fullPage: true });

const checks = [
  ["Header shows Saturday 18 July 2026", /Saturday, 18 July 2026/.test(text)],
  ["Saturday's class is listed as today's class", /Saturday Beginners/.test(text)],
  ["Not showing 'No classes today'", !/No classes today/.test(text)],
];

// Open today's class attendance and read the date the screen actually targets.
await tap(page.getByText("Mark Attendance").first(), "Mark Attendance");
await page.waitForTimeout(2500);
const url = page.url();
await page.screenshot({ path: `${SHOT}/tz-saturday-attendance.png`, fullPage: true });
console.log("attendance url:", url);

checks.push(["Attendance targets Saturday 2026-07-18", /date=2026-07-18/.test(url)]);
checks.push(["Attendance does NOT target Friday 2026-07-17", !/date=2026-07-17/.test(url)]);

let ok = true;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
await browser.close();
process.exit(ok ? 0 : 1);
