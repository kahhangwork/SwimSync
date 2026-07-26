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
      // ⚠ ONLY THE VISIBLE SCREEN. React Navigation keeps the screens you left
      // mounted, and this driver's whole subject is navigating between lessons
      // — so a plain text search finds the PREVIOUS lesson's buttons first and
      // presses those. It cost a false FAIL here: "Absent" landed on a stale
      // screen, that screen's Save ran instead, and the run read as "the fix
      // does not work" while a URL-navigated probe saved perfectly.
      //
      // React Navigation marks the inactive screen `aria-hidden="true"` — the
      // same attribute Chrome warns about in the console on this app — so that
      // is the seam, plus a non-zero box for anything display:none.
      const visible = (e) =>
        !e.closest('[aria-hidden="true"]') &&
        e.getClientRects().length > 0;

      const hits = [...document.querySelectorAll("*")].filter(
        (e) =>
          e.children.length === 0 &&
          e.textContent.trim() === label &&
          visible(e)
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

/**
 * Press the action button inside the card for a named class.
 *
 * Scoped to the CARD, not to an index into the whole page. An index broke the
 * moment a finished class started saying "Edit attendance" instead of "Mark
 * Attendance": class B's button moved from index 1 to index 0 and the driver
 * pressed the wrong card. Selecting by the class title is stable under label
 * changes, which is the whole point of a status feature.
 */
async function pressClassButton(page, classTitle) {
  const ok = await page.evaluate((classTitle) => {
    const visible = (e) =>
      !e.closest('[aria-hidden="true"]') && e.getClientRects().length > 0;
    const title = [...document.querySelectorAll("*")].find(
      (e) =>
        e.children.length === 0 &&
        e.textContent.trim() === classTitle &&
        visible(e)
    );
    if (!title) return false;
    // Walk up to the card, then find its button by either label.
    let card = title;
    for (let i = 0; i < 8 && card; i++) {
      const btn = [...card.querySelectorAll("*")].find(
        (e) =>
          e.children.length === 0 &&
          /^(Mark Attendance|Edit attendance)$/.test(e.textContent.trim()) &&
          visible(e)
      );
      if (btn) {
        const target = btn.parentElement;
        const o = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
        target.dispatchEvent(new PointerEvent("pointerdown", o));
        target.dispatchEvent(new PointerEvent("pointerup", o));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      }
      card = card.parentElement;
    }
    return false;
  }, classTitle);
  console.log(`pressed card button: ${classTitle}${ok ? "" : " (NOT FOUND)"}`);
  return ok;
}

const CLASS_ID = "e1000000-0000-0000-0000-0000000000c1";
const CLASS_B  = "e1000000-0000-0000-0000-0000000000c2";
const TODAY = sql("SELECT (now() AT TIME ZONE 'Asia/Singapore')::date");
const D_PREV = sql(`SELECT '${TODAY}'::date - 7`);

/** Statuses on one lesson, as "Name=status" pairs, ordered. The ground truth. */
function marksOn(date, classId = CLASS_ID) {
  return sql(
    `SELECT COALESCE(string_agg(s.full_name || '=' || a.status, ', ' ORDER BY s.full_name), '(none)')
       FROM lesson_sessions ls
       LEFT JOIN attendance a ON a.lesson_session_id = ls.id
       LEFT JOIN students   s ON s.id = a.student_id
      WHERE ls.class_id = '${classId}' AND ls.session_date = '${date}'`
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
  await pressClassButton(page, "Stale Screen Club");
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

  // ══════════════ THE STATUS CHIPS AND BREAKDOWN ══════════════
  // Class A's lesson today is now fully marked (both present, above) and class
  // B's is partially marked (one of two, from the fixture). So one Today screen
  // carries a `Marked` card, a `1 of 2 marked` card and a `Not marked` backlog
  // row, which is every state a real screen can show at once.
  t = await dumpText(page);

  check(
    "a fully marked class shows the Marked chip",
    /Marked/.test(t) && /2 present/.test(t),
    (t.match(/2 students · [^\n]*/) ?? ["(no breakdown)"])[0]
  );

  check(
    "a partially marked class shows the fraction",
    /1 of 2 marked/.test(t),
    (t.match(/1 of 2 marked/) ?? ["(no fraction)"])[0]
  );

  // The status chip must NEVER be green on a class nobody is enrolled in. The
  // billing gate calls an empty roster "fully marked" — correctly, there is
  // nothing to collect — and showing that to a coach would say a class was done
  // when nobody had touched it. §7.66-adjacent; the display layer owns this.
  const seedEmpty = sql(
    `SELECT count(*) FROM classes c WHERE c.day_of_week = (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int + 1]::day_of_week AND NOT EXISTS (SELECT 1 FROM student_class_enrolments e WHERE e.class_id = c.id AND e.is_active)`
  );
  check(
    "no class with an empty roster is labelled Marked",
    seedEmpty === "0" || /No students/.test(t),
    `${seedEmpty} empty class(es) running today`
  );

  // The button must go quiet ONLY when the lesson is finished. A card that stops
  // asking for marks it still needs is a lesson that never gets marked, and an
  // unmarked lesson blocks the month with no override (§8a).
  check(
    "the finished class offers Edit attendance, the unfinished one still nags",
    /Edit attendance/.test(t) && /Mark Attendance/.test(t),
    `edit=${/Edit attendance/.test(t)} mark=${/Mark Attendance/.test(t)}`
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
  await pressClassButton(page, "Stale Screen Second");
  await page.waitForTimeout(3000);
  t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ss-5-second-class.png`, fullPage: true });

  // "Second One/Two" are enrolled in the SECOND class alone, so their presence
  // is proof of which lesson is on screen. The class TITLE is not proof — the
  // screen navigated away from is still mounted and still in innerText.
  check(
    "the second class's own lesson opens",
    /Second One/.test(t) && /Second Two/.test(t),
    t.includes("Second One") ? "" : "(wrong class on screen)"
  );

  // ── §7.67: A PARTIALLY-MARKED LESSON MUST SAVE ──────────────────────────
  // This lesson arrives with ONE of its two children already marked (see the
  // fixture). The screen used to attach the attendance PK to those rows only,
  // so the key sets differed across the upsert body, `id` entered PostgREST's
  // column list, and the UNMARKED child was inserted with id = NULL against a
  // NOT NULL column — 23502, and the whole statement refused. The coach saw
  // only "Failed to save attendance. Please try again." and the lesson could
  // never be completed.
  check(
    "the fixture's lesson really is partially marked",
    marksOn(TODAY, CLASS_B) === "Second One=present",
    marksOn(TODAY, CLASS_B)
  );

  // Set BOTH: a correction to the marked child and a first mark for the other,
  // which is the mixed insert/update the bug needed.
  await pressByText(page, "Absent", 0);
  await pressByText(page, "Absent", 1);
  await pressByText(page, "Save Attendance");
  await page.waitForTimeout(3500);

  check(
    "completing a partially-marked lesson saves BOTH children",
    marksOn(TODAY, CLASS_B) === "Second One=absent, Second Two=absent",
    marksOn(TODAY, CLASS_B)
  );
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
