// §7.64 — ATTENDANCE MUST LAND ON THE LESSON THE COACH IS LOOKING AT.
//
// This is the one thing no unit test in this repo can reach, and the reason is
// the bug itself: it lives in the ROUTER, not in any function. Every lesson is
// marked at the same route, /(coach)/classes/[id]/attendance, distinguished
// only by `?date=`. Expo Router reuses the mounted screen when a search param
// changes, so a mount-only effect never reloads and the screen keeps the
// PREVIOUS lesson's session id while the header repaints to the new date.
//
// It reproduces ONLY on in-app navigation. A deep link (page.goto) mounts a
// fresh screen and passes cleanly, which is exactly why the existing
// verify-attendance-guard.mjs — which navigates by URL throughout — scored
// 14/14 against a build that was silently writing attendance to the wrong day.
// This driver therefore CLICKS through: Today's card, then the backlog row.
//
// What happened in production on 2026-07-26: the coach marked Sun 19 Jul from
// the Unmarked Lessons list, saw "Attendance saved.", and the two rows landed
// on the Sun 26 Jul session. 19 Jul stayed unmarked — correctly, nothing was
// written to it — while today's lesson silently acquired statuses nobody had
// entered for it. A 200 and a success toast the whole way.
//
// Setup (from repo root):
//   supabase db reset && docker restart supabase_db_SwimSync   # §7.44
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-stale-screen.sql
//   cd SwimSyncApp && npx expo start --web    # :8081
//   node .claude/skills/run-ui-playwright/drivers/verify-stale-screen.mjs
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-stale-screen-teardown.sql
//
// The admin panel is NOT needed — this is entirely a coach-app flow.
import os from "node:os";
import { execSync } from "node:child_process";
import { launch, loginExpo, dumpText, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// Newlines are flattened: psql -c reads a backslash-n as the start of a
// backslash COMMAND, so a pretty-printed query dies with "syntax error at or
// near \".
function sql(q) {
  const oneLine = q.replace(/\s+/g, " ").trim();
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc ${JSON.stringify(oneLine)}`,
    { encoding: "utf8" }
  ).trim();
}

/**
 * Press an RN-web Pressable by its exact label text.
 *
 * Lifted from verify-attendance-guard.mjs — see its comment for why
 * click({force:true}) is not enough (§7.58): the screen you navigated away
 * from stays mounted and can be laid out ON TOP, so a coordinate click lands
 * on the wrong element and the run reads as "the save is broken".
 */
async function pressByText(page, label, index = 0) {
  const ok = await page.evaluate(
    ({ label, index }) => {
      const hits = [...document.querySelectorAll("*")].filter(
        (e) => e.children.length === 0 && e.textContent.trim() === label
      );
      const el = hits[index];
      if (!el) return false;
      const target = el.parentElement;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
      target.dispatchEvent(new PointerEvent("pointerdown", opts));
      target.dispatchEvent(new PointerEvent("pointerup", opts));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    },
    { label, index }
  );
  console.log(`pressed: ${label}${ok ? "" : " (NOT FOUND)"}`);
  return ok;
}

const CLASS_ID = "e1000000-0000-0000-0000-0000000000c1";
const TODAY = sql("SELECT (now() AT TIME ZONE 'Asia/Singapore')::date");
const D_PREV = sql(`SELECT '${TODAY}'::date - 7`);

/** Statuses on one lesson, as "Name=status" pairs, ordered. The ground truth. */
function marksOn(date) {
  return sql(
    `SELECT COALESCE(string_agg(s.full_name || '=' || a.status, ', ' ORDER BY s.full_name), '(none)')
       FROM lesson_sessions ls
       LEFT JOIN attendance a ON a.lesson_session_id = ls.id
       LEFT JOIN students   s ON s.id = a.student_id
      WHERE ls.class_id = '${CLASS_ID}' AND ls.session_date = '${date}'`
  );
}

console.log({ CLASS_ID, TODAY, D_PREV });

const mobile = {
  viewport: { width: 420, height: 900 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "Asia/Singapore",
};
const { browser } = await launch();

try {
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await loginExpo(page, "coach@swimsync.test", "password123");
  await page.waitForTimeout(3000);

  let t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ss-1-today.png`, fullPage: true });

  check(
    "the backlog offers last week's lesson, and only that one",
    /Unmarked Lessons \(1\)/.test(t),
    t.match(/Unmarked Lessons \([0-9]+\)/)?.[0] ?? "(no backlog heading)"
  );

  // ── 1. Mark TODAY's lesson, from Today's card ────────────────────────────
  await pressByText(page, "Mark Attendance");
  await page.waitForTimeout(2500);
  t = await dumpText(page);
  check(
    "today's lesson opens with both children",
    /Stale One/.test(t) && /Stale Two/.test(t),
    t.includes("Stale One") ? "" : "(roster missing)"
  );

  await pressByText(page, "Present", 0);
  await pressByText(page, "Present", 1);
  await page.waitForTimeout(400);
  await pressByText(page, "Save Attendance");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOT}/ss-2-after-today.png`, fullPage: true });

  check(
    "today's lesson is saved as both present",
    marksOn(TODAY) === "Stale One=present, Stale Two=present",
    marksOn(TODAY)
  );

  // ── 2. Now the backlog row — SAME ROUTE, different ?date= ────────────────
  // This is the navigation that reuses the screen. Everything above exists to
  // put a resolved session id for TODAY into component state first.
  t = await dumpText(page);
  check(
    "after saving today, the backlog still lists last week's lesson",
    /Unmarked Lessons/.test(t),
    t.match(/Unmarked Lessons \([0-9]+\)/)?.[0] ?? "(backlog gone)"
  );

  await pressByText(page, "Mark");
  await page.waitForTimeout(3000);
  t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ss-3-backlog-open.png`, fullPage: true });

  // THE TELL. Pre-fix the screen never reloaded, so both children still carry
  // the Present chips from today's save. A correctly reloaded screen shows
  // last week's lesson, which has no attendance at all — nothing selected.
  const presentChips = await page.evaluate(() =>
    [...document.querySelectorAll("*")].filter(
      (e) =>
        e.children.length === 0 &&
        e.textContent.trim() === "Present" &&
        getComputedStyle(e).color === "rgb(255, 255, 255)"
    ).length
  );
  check(
    "opening last week's lesson does NOT inherit today's selections",
    presentChips === 0,
    `${presentChips} status chip(s) still selected`
  );

  // ── 3. Mark last week ABSENT, and see where it lands ─────────────────────
  await pressByText(page, "Absent", 0);
  await pressByText(page, "Absent", 1);
  await page.waitForTimeout(400);
  await pressByText(page, "Save Attendance");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOT}/ss-4-after-prev.png`, fullPage: true });

  const prev = marksOn(D_PREV);
  const today = marksOn(TODAY);

  check(
    "last week's lesson receives the marks that were entered for it",
    prev === "Stale One=absent, Stale Two=absent",
    `${D_PREV}: ${prev}`
  );

  // The destructive half. Pre-fix this is where the damage shows: today's
  // session is flipped to absent by a save the coach made on another date.
  check(
    "TODAY'S LESSON IS UNTOUCHED by a save made on another date",
    today === "Stale One=present, Stale Two=present",
    `${TODAY}: ${today}`
  );

  // ── 4. And the backlog clears, which is what the coach came for ──────────
  await page.waitForTimeout(2000);
  t = await dumpText(page);
  check(
    "the Unmarked Lessons banner clears once the lesson is really marked",
    !/Unmarked Lessons/.test(t),
    t.match(/Unmarked Lessons \([0-9]+\)/)?.[0] ?? "(cleared)"
  );

  // ══════════════ THE NAVIGATION HALF ══════════════
  // Saving must return the coach to where they came FROM, not to whatever the
  // Classes stack happens to be holding. This screen lives in the Classes tab
  // (classes/_layout.tsx) but is pushed from Today too, and switching tabs
  // does not unwind that stack — so it accumulates one attendance screen per
  // lesson visited, and router.back() popped into the previous LESSON.
  //
  // The coach's report: marked the 8:45 class, pressed the back chevron,
  // marked the 9:30 class, and saving returned them to the 8:45 screen with
  // its session id still in the URL.
  check(
    "saving leaves the attendance screen entirely",
    !/\/attendance\?/.test(page.url()),
    page.url().replace(EXPO, "")
  );

  // Now the second class, from Today — this is the push that used to stack on
  // top of the first one.
  await pressByText(page, "Mark Attendance", 1);
  await page.waitForTimeout(3000);
  t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ss-5-second-class.png`, fullPage: true });

  // "Second Only" is enrolled in the SECOND class alone, so its presence is
  // proof of which lesson is on screen. The class TITLE is not proof — the
  // screen navigated away from is still mounted and still in innerText.
  check(
    "the second class's own lesson opens",
    /Second Only/.test(t),
    t.includes("Second Only") ? "" : "(wrong class on screen)"
  );

  await pressByText(page, "Present", 0);
  await pressByText(page, "Save Attendance");
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOT}/ss-6-after-second.png`, fullPage: true });

  const landedOn = page.url().replace(EXPO, "");
  check(
    "saving the SECOND lesson does not land on the FIRST lesson's screen",
    !/\/attendance\?/.test(landedOn),
    landedOn
  );

  // And the first class's marks are still what they were — a save on class B
  // must not touch class A.
  check(
    "class A's lesson is untouched by class B's save",
    marksOn(TODAY) === "Stale One=present, Stale Two=present",
    `${TODAY} class A: ${marksOn(TODAY)}`
  );
} finally {
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
