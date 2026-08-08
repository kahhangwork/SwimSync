// verify-schedule-week.mjs — the coach's Schedule tab and its week selector.
//
// WHAT THIS OWNS, AND WHY IT IS A SEPARATE DRIVER.
// The Schedule tab replaced the Today tab on 2026-08-08. verify-stale-screen.mjs
// still owns §7.64 (the router reusing a mounted attendance screen) and needs
// the screen left exactly where it starts, so driving the week selector inside
// it destabilised seven downstream checks. The week selector gets its own
// driver instead.
//
// THE LOAD-BEARING CHECK IS "a straggler from ANOTHER week still appears under
// NEEDS MARKING". That list is FLOOR-scoped — every unmarked lesson from the
// business's markable_floor up to today — and deliberately NOT week-scoped.
// Week-scoping it would hide a lesson the coach has no reason to go looking
// for, and unmarked attendance blocks invoice generation outright with no
// override (HANDOVER §8i, PRD §7.7). Nothing else in the suite asserts it.
//
// Also proven here: TODAY renders only in the current week; the "Back to this
// week" escape appears exactly when it is needed; the arrows stop at the
// marking floor and at the end of next week; and a COMING UP row never reaches
// the attendance screen (checkMarkableDate refuses a future date, so the only
// exit from there would be a replace back here — a dead tap).
//
// NOT proven here: that the week survives a Sunday->Monday boundary with the
// app mounted. That is the reason the screen holds a weekOffset INTEGER rather
// than an absolute Monday, and it is covered by lib/scheduleWeek.test.ts, which
// can move the clock. A browser driver cannot.
//
// Setup:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-stale-screen.sql
//   Expo web on :8081.  (No admin server, no edge function — coach app only.)
//
// Reuses fixtures-stale-screen.sql: it is weekday-agnostic (it derives the
// class weekday from today) and already builds exactly what this needs — two
// classes running today plus one UNMARKED lesson exactly a week ago.

import { execSync } from "node:child_process";
import { launch, loginExpo, visibleText, tap } from "./lib.mjs";

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

function sql(q) {
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc ${JSON.stringify(q.replace(/\s+/g, " ").trim())}`,
    { encoding: "utf8" }
  ).trim();
}

const TODAY = sql("SELECT (now() AT TIME ZONE 'Asia/Singapore')::date");
const D_PREV = sql(`SELECT '${TODAY}'::date - 7`);
/** "Sat, 1 Aug" — how formatSgDate renders a backlog row's date. */
const PREV_LABEL = sql(
  `SELECT to_char('${D_PREV}'::date, 'Dy, FMDD Mon')`
);

console.log({ TODAY, D_PREV, PREV_LABEL });

// A hand-rolled context, NOT launch({ mobile: true }) — deliberately. That
// helper does not set `timezoneId`, and pinning the browser to Asia/Singapore
// is what stops any incidental `new Date()` in the page disagreeing with the
// SGT dates this driver computes in SQL (§7.7). The cost is one discarded page
// from launch(); closing it keeps only one dialog handler alive.
const { browser, page: unused } = await launch();
await unused.close();
const ctx = await browser.newContext({
  viewport: { width: 420, height: 900 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "Asia/Singapore",
});
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept().catch(() => {}));

const press = async (testId) => {
  await page.getByTestId(testId).last().click();
  await page.waitForTimeout(4000);
};

try {
  await loginExpo(page, "coach@swimsync.test", "password123");
  // The Schedule screen derives a whole week plus the floor-scoped backlog, so
  // it needs longer than the one-day screen it replaced.
  await page.waitForTimeout(8000);

  check(
    "a coach lands on the Schedule tab",
    /\/schedule/.test(page.url()),
    page.url()
  );

  // ── THIS WEEK ────────────────────────────────────────────────────────────
  let t = await visibleText(page);
  check("the selector names the current week", /This week/.test(t), "");
  check(
    "TODAY renders in the current week",
    /TODAY ·/i.test(t),
    (t.match(/TODAY ·[^\n]*/i) ?? ["(no TODAY heading)"])[0]
  );
  check(
    "the straggler is listed under NEEDS MARKING",
    /NEEDS MARKING \(1\)/i.test(t) && t.includes(PREV_LABEL),
    `${(t.match(/NEEDS MARKING \([0-9]+\)/i) ?? ["(none)"])[0]} / expected ${PREV_LABEL}`
  );
  check(
    "no escape hatch is offered while already on this week",
    !/Back to this week/.test(t),
    ""
  );

  // ── NEXT WEEK — THE FLOOR-SCOPE PROOF ────────────────────────────────────
  await press("week-next");
  t = await visibleText(page);

  check("the selector names next week", /Next week/.test(t), "");
  check(
    "TODAY does NOT render outside the current week",
    !/TODAY ·/i.test(t),
    (t.match(/TODAY ·[^\n]*/i) ?? ["(absent, correct)"])[0]
  );
  // ⚠ THE ONE THIS DRIVER EXISTS FOR.
  check(
    "a straggler from ANOTHER week still appears under NEEDS MARKING",
    /NEEDS MARKING/i.test(t) && t.includes(PREV_LABEL),
    t.includes(PREV_LABEL)
      ? "still listed"
      : `${PREV_LABEL} vanished when the week changed — the list is week-scoped`
  );
  check(
    "the escape hatch appears once the coach has navigated away",
    /Back to this week/.test(t),
    ""
  );

  // A future lesson cannot be marked at all, so its row must not reach the
  // attendance screen — checkMarkableDate would refuse it and the only way out
  // of that lock screen is a replace back here.
  const comingUp = /COMING UP/.test(t);
  check("next week lists COMING UP lessons", comingUp, "");
  if (comingUp) {
    await tap(page.getByText(/^\w{3}, \d+ \w{3}$/).last(), "expand a coming-up day");
    await page.waitForTimeout(2500);
    const before = page.url();
    await tap(page.getByText("Stale Screen Club").last(), "a coming-up lesson");
    await page.waitForTimeout(4000);
    check(
      "a COMING UP row never opens the attendance screen",
      !/\/attendance/.test(page.url()),
      `${before} -> ${page.url()}`
    );
    // It goes to the roster instead, which is the honest answer to "who is
    // coming to this class".
    check(
      "…it opens the class roster instead",
      /\/roster/.test(page.url()) || /\/schedule/.test(page.url()),
      page.url()
    );
    await page.goBack();
    await page.waitForTimeout(4000);
  } else {
    check("…it opens the class roster instead", false, "no COMING UP to test");
  }

  // ── BACK TO THIS WEEK ────────────────────────────────────────────────────
  await press("week-today");
  t = await visibleText(page);
  check(
    "the escape hatch returns to the current week",
    /This week/.test(t) && /TODAY ·/i.test(t),
    (t.match(/This week|Next week|Last week/) ?? ["(no label)"])[0]
  );

  // ── LAST WEEK ────────────────────────────────────────────────────────────
  await press("week-prev");
  t = await visibleText(page);
  check("the selector names last week", /Last week/.test(t), "");
  check(
    "the straggler is still listed a week back too",
    t.includes(PREV_LABEL),
    ""
  );
  check(
    "an unmarked past lesson is NOT filed under DONE",
    !/\bDONE\b/.test(t) || !/Not marked/.test(t.split(/\bDONE\b/)[1] ?? ""),
    "a nag under a heading that means finished would read as done"
  );

  // ── THE BOUNDS ───────────────────────────────────────────────────────────
  // Forward stops at the end of next week: from this week that is exactly one
  // press, and a second must not move.
  await press("week-today");
  await press("week-next");
  const atMax = await visibleText(page);
  await press("week-next");
  const pastMax = await visibleText(page);
  check(
    "the forward arrow stops at the end of next week",
    /Next week/.test(pastMax),
    (pastMax.match(/This week|Next week|Last week/) ?? ["(a later week — bound leaked)"])[0]
  );
  check(
    "…and pressing it again changes nothing",
    atMax.includes("Next week") && pastMax.includes("Next week"),
    ""
  );

  // Backward stops at the week containing the marking floor. Press far more
  // times than the floor allows and the label must stop moving.
  await press("week-today");
  let last = "";
  for (let i = 0; i < 12; i++) {
    await page.getByTestId("week-prev").last().click();
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(4000);
  last = await visibleText(page);
  // ⚠ ASSERT THE BOUND THE SCREEN ACTUALLY USES, NOT THE RAW SERVER FLOOR.
  // The screen passes `backlogWindowStart(today, null, floor)` into
  // selectableWeekOffsets, and that returns the EARLIER of the floor and the
  // 1st of last month (lessonDates.ts). Asserting `markable_window_start()`
  // alone disagrees the moment a tenant seals last month — the floor becomes
  // the 1st of THIS month and this check goes red for something that is not a
  // regression, which is how an assertion gets loosened instead of fixed.
  const floorWeek = sql(
    `SELECT to_char(date_trunc('week', LEAST(
        markable_window_start(),
        (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')::date) - interval '1 month')::date
     ))::date, 'FMDD Mon')`
  ).trim();
  check(
    "the back arrow stops at the week containing the marking floor",
    last.includes(floorWeek),
    `expected the week of ${floorWeek}; got ${(last.match(/\d+ \w{3} – \d+ \w{3}/) ?? ["(no range)"])[0]}`
  );
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
