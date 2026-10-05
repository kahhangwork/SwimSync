// The admin lesson page's prev/next strip — prev/next lesson (same teaching
// coach, same date) and prev/next coach — driven IN-APP, which is the only way
// to exercise it: a deep link always mounts a fresh page, and the bug this
// guards against (§7.64, admin side) only exists when the page navigates to
// another lesson in place.
//
// THE LOAD-BEARING ASSERTIONS:
//   • Next walks the coach's lessons in time order, each exactly once, landing
//     on THAT lesson's roster — including two classes at the same time with the
//     same title, whose order must not flip (plan RISK 4);
//   • with unsaved marks, Next opens a confirm; Stay and a backdrop click keep
//     the page and the marks; Leave drops them — and psql proves the abandoned
//     lesson got NO attendance row and NO session row (plan RISK 1/2);
//   • marks saved after navigating land on the NEW lesson's session only (psql);
//   • Next/Prev coach land on that coach's earliest lesson, disabled at the ends;
//     a covered lesson sits in the substitute's sequence;
//   • assigning / removing a substitute on the page regroups the strip to match
//     the Coaches panel's "Teaching:" line (plan RISK 3);
//   • an off-weekday date with no session ("not a lesson") shows no strip.
//
// Expected sequences are DERIVED FROM psql, never hardcoded: on a Saturday the
// seed's "Saturday Beginners" joins Coach Marcus's day.
//
// The body's remount `key` is pinned by page.test.tsx (vitest), not here: if
// Next's router already remounts on a param change, no driver can isolate it.
//
// §7.25 (2026-10-05): making `go()` push even with unsaved marks failed the
// leave-confirm check (the run then aborted — it had already navigated away);
// freezing the strip's load key after its first value, so a cover change does
// not reload it, failed the cover-change check (strip empty, panel "Nav Sub").
// Both breakers reverted; 23/23 green.
//
// Setup: supabase + seed; fixtures-admin-lesson-nav.sql loaded; admin dev on
// :3000. A re-run needs a db reset (it writes attendance and a substitute
// through the UI); the teardown sweeps every row it can make.
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
const sql = (q) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -Atc "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();

const TENANT = "70000000-0000-0000-0000-000000000001";
const KID_OF = {
  "e9000000-0000-0000-0000-000000000001": "e9000000-0000-0000-0000-00000000a001",
  "e9000000-0000-0000-0000-000000000002": "e9000000-0000-0000-0000-00000000a002",
  "e9000000-0000-0000-0000-000000000003": "e9000000-0000-0000-0000-00000000a003",
  "e9000000-0000-0000-0000-000000000004": "e9000000-0000-0000-0000-00000000a004",
};
const NAV_EARLY = "e9000000-0000-0000-0000-000000000001";

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const shift = (d, n) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const DRIVE = shift(today, -7);
// The class weekday enum value for DRIVE — computed here, not with Postgres
// to_char (check-driver-dates.sh bans SQL-built day/month names).
const DRIVE_DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
  new Date(`${DRIVE}T00:00:00Z`).getUTCDay()
];

// ── The expected day, from the database ─────────────────────────────────────
// Teaching coach = the lesson's substitute, else the class rate in force (the
// same rule as lib/lessonAttribution). One row per class running on DRIVE.
const dayRows = () =>
  sql(`
    WITH cl AS (
      SELECT c.id, c.title, c.start_time,
        COALESCE(
          (SELECT sc.coach_id FROM lesson_sessions ls JOIN session_coaches sc ON sc.lesson_session_id = ls.id
            WHERE ls.class_id = c.id AND ls.session_date = '${DRIVE}' LIMIT 1),
          (SELECT r.paid_coach_id FROM class_rates r
            WHERE r.class_id = c.id AND r.effective_from <= '${DRIVE}' ORDER BY r.effective_from DESC LIMIT 1)
        ) AS coach
      FROM classes c
      WHERE c.tenant_id = '${TENANT}'
        AND c.day_of_week = '${DRIVE_DOW}'
        AND (c.deactivated_at IS NULL OR (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date > DATE '${DRIVE}')
    )
    SELECT cl.id || '|' || cl.title || '|' || to_char(cl.start_time, 'HH24MI') || '|' || cl.coach || '|' || p.full_name
      FROM cl JOIN coaches co ON co.id = cl.coach JOIN profiles p ON p.id = co.profile_id`)
    .split("\n")
    .filter(Boolean)
    .map((r) => {
      const [id, title, hhmm, coach, coachName] = r.split("|");
      return { id, title, start: Number(hhmm), coach, coachName };
    });

/** Coaches A→Z (tie → id), each with its lessons by time (tie → title → id) — lessonNav's order. */
function expectedDay() {
  const byCoach = new Map();
  for (const r of dayRows()) {
    if (!byCoach.has(r.coach)) byCoach.set(r.coach, { id: r.coach, name: r.coachName, lessons: [] });
    byCoach.get(r.coach).lessons.push(r);
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const coaches = [...byCoach.values()].sort((a, b) => a.name.localeCompare(b.name) || cmp(a.id, b.id));
  for (const c of coaches)
    c.lessons.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title) || cmp(a.id, b.id));
  return coaches;
}

const href = (classId) => `/lessons/${classId}/${DRIVE}`;
const marcusId = sql(`SELECT id FROM coaches WHERE profile_id = 'c0000000-0000-0000-0000-000000000001'`);

const { browser, page } = await launch();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

/** Wait for the strip to show the given lesson counter (it loads after the page). */
async function stripReads(lessonText) {
  await page.getByTestId("lesson-nav").waitFor({ timeout: 20000 });
  await page.waitForFunction(
    (t) => document.querySelector('[data-testid="nav-lesson-counter"]')?.textContent?.trim() === t,
    lessonText,
    { timeout: 20000 }
  ).catch(() => {});
}
const text = (id) => page.getByTestId(id).innerText().then((s) => s.trim()).catch(() => "");
const rosterIds = () =>
  page.locator('[data-testid="roster-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-student")));
const leaveModalOpen = () => page.getByTestId("nav-leave-confirm").isVisible().catch(() => false);
const pathNow = () => new URL(page.url()).pathname;
const pressed = (sid, status) =>
  page.locator(`[data-testid="roster-row"][data-student="${sid}"] [data-status="${status}"][aria-pressed="true"]`).count();
const attendanceRows = (classId) =>
  sql(`SELECT count(*) FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
        WHERE ls.class_id = '${classId}' AND ls.session_date = '${DRIVE}'`);
const sessionRows = (classId) =>
  sql(`SELECT count(*) FROM lesson_sessions WHERE class_id = '${classId}' AND session_date = '${DRIVE}'`);

try {
  const day = expectedDay();
  const marcus = day.find((c) => c.id === marcusId);
  const navSub = day.find((c) => c.name === "Nav Sub");
  check(
    "fixture: Coach Marcus teaches ≥3 lessons on the drive date and Nav Sub covers Nav Covered",
    !!marcus && marcus.lessons.length >= 3 && !!navSub && navSub.lessons.some((l) => l.id === "e9000000-0000-0000-0000-000000000004"),
    day.map((c) => `${c.name}: ${c.lessons.map((l) => l.title).join(", ")}`).join(" | ")
  );
  const mLessons = marcus.lessons;
  const marcusPos = day.indexOf(marcus) + 1;

  await loginAdmin(page, "coach@swimsync.test");

  // ── 1. First lesson of Marcus's day ───────────────────────────────────────
  await page.goto(`${ADMIN}${href(mLessons[0].id)}`, { waitUntil: "networkidle" });
  await stripReads(`Lesson 1 of ${mLessons.length}`);
  await page.screenshot({ path: shot("admin-lesson-nav-first.png"), fullPage: true });
  check(`first lesson reads "Lesson 1 of ${mLessons.length}"`, (await text("nav-lesson-counter")) === `Lesson 1 of ${mLessons.length}`, await text("nav-lesson-counter"));
  check("…Prev lesson is disabled", await page.getByTestId("nav-prev-lesson").isDisabled());
  check(
    `…coach reads "Coach Marcus (${marcusPos} of ${day.length})"`,
    (await text("nav-coach-counter")) === `Coach Marcus (${marcusPos} of ${day.length})`,
    await text("nav-coach-counter")
  );

  // ── 2. Walk Next through the whole day ────────────────────────────────────
  const visited = [mLessons[0].id];
  let walkOk = true;
  for (let i = 1; i < mLessons.length; i++) {
    await page.getByTestId("nav-next-lesson").click();
    await page.waitForURL(`**${href(mLessons[i].id)}`, { timeout: 15000 }).catch(() => {});
    await stripReads(`Lesson ${i + 1} of ${mLessons.length}`);
    const at = pathNow().split("/")[2];
    visited.push(at);
    const kid = KID_OF[mLessons[i].id];
    if (at !== mLessons[i].id) walkOk = false;
    if (kid) {
      await page.getByTestId("roster-row").first().waitFor({ timeout: 15000 });
      const ids = await rosterIds();
      if (ids.length !== 1 || ids[0] !== kid) {
        walkOk = false;
        console.log(`  roster on ${mLessons[i].title} (${at}): ${ids.join(",")} — expected ${kid}`);
      }
    }
  }
  check(
    "Next visits every lesson once, in time order (the same-time same-title pair by class id), each with its own roster",
    walkOk && visited.join() === mLessons.map((l) => l.id).join() && new Set(visited).size === visited.length,
    visited.map((id) => id.slice(-2)).join(" → ")
  );
  check("…and Next is disabled on the last lesson", await page.getByTestId("nav-next-lesson").isDisabled());

  // ── 3. Unsaved marks: Stay keeps them, Leave drops them (psql) ────────────
  const L2 = mLessons[1];
  const L3 = mLessons[2];
  check("lessons 2 and 3 are the fixture's Nav Tie pair (the stale-state check needs their rosters)", !!KID_OF[L2.id] && !!KID_OF[L3.id], `${L2.title} / ${L3.title}`);
  const l2SessionsBefore = sessionRows(L2.id);
  await page.goto(`${ADMIN}${href(L2.id)}`, { waitUntil: "networkidle" });
  await stripReads(`Lesson 2 of ${mLessons.length}`);
  await page.getByTestId("roster-row").first().waitFor({ timeout: 15000 });
  const kid2 = KID_OF[L2.id];
  await page.locator(`[data-testid="roster-row"][data-student="${kid2}"] [data-status="present"]`).click();

  await page.getByTestId("nav-next-lesson").click();
  await page.waitForTimeout(500);
  check("with unsaved marks, Next opens the leave confirm instead of navigating", await leaveModalOpen());
  await page.screenshot({ path: shot("admin-lesson-nav-leave-confirm.png") });
  await page.getByTestId("nav-leave-stay").click();
  await page.waitForTimeout(800);
  check(
    "Stay: still on lesson 2, modal closed, the unsaved mark still selected",
    pathNow() === href(L2.id) && !(await leaveModalOpen()) && (await pressed(kid2, "present")) === 1,
    pathNow()
  );

  await page.getByTestId("nav-next-lesson").click();
  await page.waitForTimeout(500);
  await page.mouse.click(8, 8); // the backdrop, outside the panel
  await page.waitForTimeout(800);
  check(
    "a backdrop click also stays: same URL, modal closed, mark kept",
    pathNow() === href(L2.id) && !(await leaveModalOpen()) && (await pressed(kid2, "present")) === 1,
    pathNow()
  );

  await page.getByTestId("nav-next-lesson").click();
  await page.getByTestId("nav-leave-confirm").waitFor({ timeout: 5000 });
  await page.getByTestId("nav-leave-confirm").click();
  await page.waitForURL(`**${href(L3.id)}`, { timeout: 15000 }).catch(() => {});
  await stripReads(`Lesson 3 of ${mLessons.length}`);
  await page.getByTestId("roster-row").first().waitFor({ timeout: 15000 });
  check("Leave anyway: lands on lesson 3", pathNow() === href(L3.id), pathNow());
  check(
    "DB: the abandoned lesson 2 has 0 attendance rows and no new session row",
    attendanceRows(L2.id) === "0" && sessionRows(L2.id) === l2SessionsBefore,
    `attendance=${attendanceRows(L2.id)} sessions ${l2SessionsBefore}→${sessionRows(L2.id)}`
  );
  check("lesson 3 shows lesson 3's child only, nothing pressed, no save message carried over",
    (await rosterIds()).join() === KID_OF[L3.id] &&
      (await page.locator('[data-testid="roster-row"] [aria-pressed="true"]').count()) === 0 &&
      (await page.getByTestId("save-message").count()) === 0
  );

  const kid3 = KID_OF[L3.id];
  await page.locator(`[data-testid="roster-row"][data-student="${kid3}"] [data-status="present"]`).click();
  await page.getByTestId("save-attendance").click();
  await page.getByTestId("save-message").waitFor({ timeout: 15000 });
  const saveMsg = await text("save-message");
  check("saving on lesson 3 reports one mark", /Saved 1 mark/.test(saveMsg), saveMsg);
  const l3Rows = sql(`SELECT string_agg(a.student_id::text || ':' || a.status, ',') FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
                       WHERE ls.class_id = '${L3.id}' AND ls.session_date = '${DRIVE}'`);
  check(
    "DB: the mark is on lesson 3's session for lesson 3's child; lessons 1 and 2 still have none",
    l3Rows === `${kid3}:present` && attendanceRows(mLessons[0].id) === "0" && attendanceRows(L2.id) === "0",
    `L3=${l3Rows} L1=${attendanceRows(mLessons[0].id)} L2=${attendanceRows(L2.id)}`
  );

  // ── 4. Coach navigation ────────────────────────────────────────────────────
  await page.goto(`${ADMIN}${href(mLessons[0].id)}`, { waitUntil: "networkidle" });
  await stripReads(`Lesson 1 of ${mLessons.length}`);
  const coachWalk = [];
  // Rewind to the first coach, then walk forward.
  for (let i = marcusPos; i > 1; i--) {
    await page.getByTestId("nav-prev-coach").click();
    await page.waitForURL(`**${href(day[i - 2].lessons[0].id)}`, { timeout: 15000 }).catch(() => {});
    await stripReads(`Lesson 1 of ${day[i - 2].lessons.length}`);
  }
  check("Prev coach is disabled on the first coach", await page.getByTestId("nav-prev-coach").isDisabled());
  let coachOk = true;
  for (let i = 0; i < day.length; i++) {
    const c = day[i];
    const label = await text("nav-coach-counter");
    coachWalk.push(label);
    if (pathNow() !== href(c.lessons[0].id) || label !== `${c.name} (${i + 1} of ${day.length})`) coachOk = false;
    if (i < day.length - 1) {
      await page.getByTestId("nav-next-coach").click();
      await page.waitForURL(`**${href(day[i + 1].lessons[0].id)}`, { timeout: 15000 }).catch(() => {});
      await stripReads(`Lesson 1 of ${day[i + 1].lessons.length}`);
    }
  }
  check("Next coach walks every coach A→Z, each landing on that coach's EARLIEST lesson", coachOk, coachWalk.join(" → "));
  check("Next coach is disabled on the last coach", await page.getByTestId("nav-next-coach").isDisabled());
  await page.goto(`${ADMIN}${href(navSub.lessons[0].id)}`, { waitUntil: "networkidle" });
  await stripReads(`Lesson 1 of ${navSub.lessons.length}`);
  check(
    "the covered Nav Covered lesson sits in Nav Sub's sequence, not Marcus's",
    (await text("nav-coach-counter")).startsWith("Nav Sub (") && !mLessons.some((l) => l.id === "e9000000-0000-0000-0000-000000000004"),
    await text("nav-coach-counter")
  );

  // ── 5. Cover change regroups the strip to match the Coaches panel ─────────
  await page.goto(`${ADMIN}${href(NAV_EARLY)}`, { waitUntil: "networkidle" });
  await stripReads(`Lesson 1 of ${mLessons.length}`);
  await page.getByLabel("Substitute coach").selectOption({ label: "Nav Sub" });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await page.waitForFunction(
    () => /Nav Sub/.test(document.querySelector('[data-testid="nav-coach-counter"]')?.textContent ?? ""),
    null,
    { timeout: 20000 }
  ).catch(() => {});
  let body = await page.locator("body").innerText();
  check(
    "after assigning Nav Sub: the strip's coach AND the Coaches panel both say Nav Sub",
    (await text("nav-coach-counter")).startsWith("Nav Sub (") && /Teaching:\s*Nav Sub/.test(body),
    `${await text("nav-coach-counter")} / ${body.match(/Teaching:[^\n]*/)?.[0] ?? "(no Teaching line)"}`
  );
  await page.screenshot({ path: shot("admin-lesson-nav-covered.png"), fullPage: true });
  await page.getByRole("button", { name: /Remove substitute/ }).click();
  await page.waitForFunction(
    () => /Coach Marcus/.test(document.querySelector('[data-testid="nav-coach-counter"]')?.textContent ?? ""),
    null,
    { timeout: 20000 }
  ).catch(() => {});
  body = await page.locator("body").innerText();
  check(
    "after removing it: both revert to Coach Marcus",
    (await text("nav-coach-counter")).startsWith("Coach Marcus (") && /Teaching:\s*Coach Marcus/.test(body),
    `${await text("nav-coach-counter")} / ${body.match(/Teaching:[^\n]*/)?.[0] ?? "(no Teaching line)"}`
  );

  // ── 6. Not a lesson: no strip ─────────────────────────────────────────────
  await page.goto(`${ADMIN}/lessons/${NAV_EARLY}/${shift(DRIVE, 1)}`, { waitUntil: "networkidle" });
  await page.getByTestId("not-a-lesson").waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500); // give the strip's own load time to (not) appear
  check("an off-weekday date with no session shows no strip", (await page.getByTestId("lesson-nav").count()) === 0);

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || "));
} catch (e) {
  check("driver ran to completion", false, String(e).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
