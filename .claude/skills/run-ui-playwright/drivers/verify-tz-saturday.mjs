// §7.7 — THE SGT/UTC SPLIT THAT SHIPPED A REAL DOUBLE-BILLING BUG.
//
// A coach opening the app at 07:30 SGT on a Saturday. Before the fix the screen
// listed SATURDAY's classes (a local `getDay()`) but handed the attendance
// screen FRIDAY's date (`toISOString().split("T")[0]`, which is the UTC date —
// a day behind before 08:00 SGT). The weekday and the date disagreed, and the
// session was written against the wrong day.
//
// This driver exists because that disagreement is only reachable in the
// 00:00–08:00 SGT window, which no ordinary test run ever hits. Playwright's
// `clock.install` + `timezoneId` is what makes it reproducible at any hour:
// the browser genuinely believes it is 07:30 on Saturday 18 July 2026 in
// Singapore, while UTC still says Friday the 17th.
//
// ⚠ THE DATE PAIR IS THE WHOLE FIXTURE. 2026-07-18 07:30 SGT is
// 2026-07-17 23:30 UTC — Saturday in Singapore, Friday in UTC. If you change
// the instant, keep that property or the driver proves nothing.
//
// Setup:
//   cd SwimSyncApp && npx expo start --web    # :8081
//   node .claude/skills/run-ui-playwright/drivers/verify-tz-saturday.mjs
//
// Needs only seed data (the "Saturday Beginners" class) — no fixture, and
// therefore no teardown. The checks are about DATES, not the roster, so they
// hold whether or not that class has students.

import os from "node:os";
import { launch, loginExpo, tap, dumpText } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
// 2026-07-18 07:30 SGT == 2026-07-17 23:30 UTC. Friday in UTC, Saturday in SG.
const AT_0730_SGT_SATURDAY = new Date("2026-07-17T23:30:00Z");

const results = [];
function check(label, cond, detail = "") {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const { browser } = await launch();

try {
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

  // Every check carries a `detail`, so a failure says what the screen actually
  // showed rather than only that it was wrong. Without it, "Header shows
  // Saturday 18 July 2026 — FAIL" sends you back to the browser to find out
  // whether the date, the weekday, or both had slipped.
  const header = /\w+day, \d+ \w+ \d{4}/.exec(text)?.[0] ?? "(no date header found)";
  check(
    "the header reads Saturday 18 July 2026 — the SG date, not the UTC one",
    /Saturday, 18 July 2026/.test(text),
    header
  );
  check(
    "Saturday's class is listed as today's class",
    /Saturday Beginners/.test(text),
    /Saturday Beginners/.test(text) ? "" : "seed's Saturday class missing from Today"
  );
  check(
    "the screen does not claim there are no classes today",
    !/No classes today/.test(text),
    /No classes today/.test(text) ? "screen says 'No classes today'" : ""
  );

  // The other half of §7.7, and the half that actually mis-billed: the DATE the
  // attendance screen targets. The list above can be right while this is wrong
  // — that disagreement IS the bug.
  await tap(page.getByText("Mark Attendance").first(), "Mark Attendance");
  await page.waitForTimeout(2500);
  const url = page.url();
  await page.screenshot({ path: `${SHOT}/tz-saturday-attendance.png`, fullPage: true });

  check(
    "attendance targets Saturday 2026-07-18",
    /date=2026-07-18/.test(url),
    url
  );
  check(
    "attendance does NOT target Friday 2026-07-17 (the UTC date)",
    !/date=2026-07-17/.test(url),
    url
  );
} catch (e) {
  // §7.79 — a driver that lets an exception escape reports its failure as a
  // stack trace with no tally, and (before the `finally` below) leaked the
  // browser process too. Record the crash AS A FAILED CHECK so it travels
  // through the same counter as everything else.
  check(
    `the driver ran to completion — it crashed: ${e.message}`,
    false,
    String(e.stack ?? e).slice(0, 400)
  );
} finally {
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  // A run that asserted NOTHING is a failure, not a pass — otherwise deleting
  // the checks above would turn this green.
  process.exit(results.length > 0 && passed === results.length ? 0 : 1);
}
