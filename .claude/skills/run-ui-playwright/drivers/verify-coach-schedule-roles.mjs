// verify-coach-schedule-roles.mjs — the coach Schedule tab, (coach)/schedule,
// on the three things no driver asserted:
//
//   1. THE ROLE BADGES on today's cards, for three coaches of one business:
//      the rostered substitute sees "Covering" + Mark Attendance, the class
//      shadow "Shadowing" + View lesson, the owner whose lesson was covered
//      "Covered" + View lesson (lib/coachRoster.ts roleBadge/canMark,
//      features/schedule/ui/RoleBadge.tsx, TodaySection.tsx).
//   2. THE LOCATION CHIPS: shown only when the week spans > 1 location
//      (LocationChips.tsx), each chip filters the week — and THE CLAMP
//      (useScheduleSections.ts): when the selected location loses its last
//      lesson the chips vanish and the week must render UNFILTERED, not empty
//      with no control left to clear the filter.
//   3. A DONE ROW TAP (DaySection.tsx) → `/classes/<id>/attendance?date=<d>
//      &from=schedule` (useScheduleSections.ts openAttendance), exact URL.
//
// Fixture: fixtures-coach-schedule-roles.sql   Teardown: fixtures-coach-schedule-roles-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U11 (promotes the old docs/refactor
// coach-schedule hand-check). BACKLOG item: "A driver for the coach Schedule's
// role badges, location chips and DONE tap".
//
// OWN BUSINESS (CoachSched Swim), three PLAIN coaches — never the seed coach.
// Both classes run on TODAY's weekday (read from the DB, never recomputed:
// plan rule 4) after 12:00, and the browser clock is installed at today 12:00
// SGT (rule 13), so today's two lessons are upcoming and unmarked at any real
// hour, including the nightly's 04:00. Nothing waits on or asserts the
// greeting (rule 11). Screen text is read with visibleText() and presses go
// by DOM on the visible screen (§7.10/§7.58); navigation is by TAB taps, and
// every card assertion is scoped to that card's slice of the TODAY section.
//
// The clamp step is the driver's only write: `UPDATE classes SET is_active =
// false, deactivated_at = now()` on the fixture's OWN Covered class, through
// psql as postgres (guard_class_retirement is bypassed: auth.uid() is NULL, so
// it cannot fail for a product reason — it still throws on a non-zero exit).
// It is restored in a `finally` and the restore is ASSERTED; the fixture
// reload and the teardown restore it regardless. ONE class, not the hand-
// check's two: retiring the North class alone leaves the South class as the
// week's only location, which is what lets the check see the week render
// UNFILTERED (retiring both would leave an empty week, where "unfiltered" and
// "filtered to nothing" look the same).
//
// No dialog is involved; the auto-accept listener is removed anyway so a
// surprise confirm is recorded and fails a check (§7.279).
//
// MUTATION PROOFS (§7.25) — each made on app code, the served Expo bundle
// grepped for the mutated code (present) and after the revert (absent)
// (§7.253), run, seen red, reverted (`git diff --exit-code -- SwimSyncApp` clean):
//
//   | # | mutation | result | red checks |
//   |---|----------|--------|------------|
//   | 1 | lib/coachRoster.ts:180 → `case "shadow":  return null;` (the badge vanishes)   | 27/28 | "⚠ shadow: the Shadowed card is badged 'Shadowing'" (the card read … CoachSched South \| Upcoming …) |
//   | 2 | useScheduleSections.ts:97 → drop `&from=schedule` from openAttendance      | 27/28 | "⚠ the DONE tap opens EXACTLY /classes/<Shadowed>/attendance?date=<that day>&from=schedule" (got …?date=2026-09-19) |
//
// (2026-09-26, both reverted; the served bundle held the `// MUTATION-PROOF` line after each
// edit and not after each revert, where `return "Shadowing"` / `…&from=schedule` were back.)

import { execFileSync } from "node:child_process";
import { launch, loginExpo, pressByText, visibleText, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
const API_URL = "http://127.0.0.1:54321";
for (const u of [ADMIN, EXPO]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) {
    console.error(`refusing to run against a non-local URL: ${u}`);
    process.exit(2);
  }
}

const EXPECTED_CHECKS = 28;

const DB = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split("\n").find((n) => n.startsWith("supabase_db_"));
if (!DB) throw new Error("no running supabase_db_* container — `supabase start` first");
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-Atc", q], { encoding: "utf8" }).trim();
// Poll the VISIBLE screen's text until `ok` — never a bare sleep (rule 13).
async function screenUntil(page, ok, ms = 20000) {
  const end = Date.now() + ms;
  let t = await visibleText(page);
  while (!ok(t) && Date.now() < end) {
    await page.waitForTimeout(300);
    t = await visibleText(page);
  }
  return t;
}

const TENANT = "d8000000-0000-0000-0000-000000000001";
const COVERED = "d8000000-0000-0000-0000-0000000000c1";
const SHADOWED = "d8000000-0000-0000-0000-0000000000c2";
const DONE_SESSION = "d8000000-0000-0000-0000-0000000000e2";
const T_COV = "CoachSched Covered";
const T_SH = "CoachSched Shadowed";
const NORTH = "CoachSched North";
const SOUTH = "CoachSched South";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const todaySg = sql(`SELECT today_sg()`);
// The DONE lesson's date, READ from the row the fixture wrote (rule 4).
const doneDate = sql(`SELECT session_date FROM lesson_sessions WHERE id = '${DONE_SESSION}'`);
// The day heading, built with the APP's formatter family (§7.121: never
// to_char for a label — ICU says "Sept"): scheduleFormat.ts dayHeading →
// formatSgDate → toLocaleDateString("en-SG", …, timeZone "UTC").
const doneHeading = new Date(`${doneDate}T00:00:00Z`)
  .toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// ── Scoped queries ──────────────────────────────────────────────────────────
const activeQ = `SELECT string_agg(title || ':' || is_active || ':' || (deactivated_at IS NULL), ',' ORDER BY title)
                   FROM classes WHERE tenant_id = '${TENANT}'`;
const ACTIVE_BOTH = `${T_COV}:true:true,${T_SH}:true:true`;
const stateQ = `SELECT (SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%') || '/' ||
                       (SELECT count(*) FROM session_coaches sc JOIN lesson_sessions s ON s.id = sc.lesson_session_id
                         WHERE s.class_id = '${COVERED}' AND s.session_date = today_sg()) || '/' ||
                       (SELECT count(*) FROM class_shadow_coaches WHERE class_id = '${SHADOWED}' AND effective_to IS NULL) || '/' ||
                       (SELECT coalesce(string_agg(status::text, ','), '') FROM attendance
                         WHERE lesson_session_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%'))`;
const STATE0 = "2/1/1/present";

// The slice of the TODAY section that belongs to ONE card: from its title to
// the next card's title (or the tab bar). "" when the title is not in TODAY.
function todayCard(t, title) {
  const i = t.indexOf("TODAY ·");
  if (i < 0) return "";
  const sec = t.slice(i);
  const s = sec.indexOf(`\n${title}\n`);
  if (s < 0) return "";
  const rest = sec.slice(s + title.length + 2);
  const ends = [T_COV, T_SH].filter((x) => x !== title).map((x) => rest.indexOf(`\n${x}\n`))
    .concat([rest.indexOf("\nSchedule\n")]).filter((n) => n >= 0);
  return rest.slice(0, ends.length ? Math.min(...ends) : undefined);
}
const lessonCount = (t) => (t.match(/TODAY · [^\n]*\n(\d+ lessons?|No lessons today\.)/) ?? [])[1] ?? "(none)";
const oneLine = (s) => s.replace(/\n+/g, " | ");

// Press a VISIBLE element by its data-testid (icon-only controls), by DOM.
const pressTestId = (page, id) =>
  page.evaluate((id) => {
    const el = [...document.querySelectorAll(`[data-testid="${id}"]`)]
      .find((e) => !e.closest('[aria-hidden="true"]') && e.getClientRects().length > 0);
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, id);

// Every browser this driver opens: rule-14 origin guard, dialog recorder,
// browser clock at today 12:00 SGT.
const dialogs = [];
const apiOrigins = new Set();
const opened = [];
async function openCoach(email) {
  const { browser, ctx, page } = await launch({ mobile: true });
  opened.push({ browser, page });
  page.setDefaultTimeout(15000);
  await ctx.clock.install({ time: new Date(`${todaySg}T12:00:00+08:00`) });
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (/^\/(auth|rest|functions)\/v1\//.test(u.pathname)) apiOrigins.add(u.origin);
  });
  await loginExpo(page, email);
  // Rule 14, the API half: the app must be talking to the LOCAL stack.
  const foreign = [...apiOrigins].filter((o) => o !== API_URL);
  if (apiOrigins.size === 0 || foreign.length) {
    console.error(`refusing: the app's API origin is not ${API_URL} (${[...apiOrigins].join(", ") || "none seen"})`);
    await browser.close();
    process.exit(2);
  }
  return page;
}

// Leave the Schedule tab and come back: the focus refetch (useFocusEffect)
// is what re-reads the week after a DB change. Waits for the Classes screen
// to be the visible one first, so the return is a real re-focus.
async function refocusSchedule(page, ok) {
  if (!(await pressByText(page, "Classes"))) throw new Error("the Classes tab was not pressable");
  await screenUntil(page, (t) => !t.includes("TODAY ·") && !t.includes("This week"), 15000);
  if (!(await pressByText(page, "Schedule"))) throw new Error("the Schedule tab was not pressable");
  return screenUntil(page, ok, 20000);
}

let clampTouched = false;
try {
  // ── 0. Preconditions: the fixture is freshly loaded ────────────────────────
  const a0 = sql(activeQ);
  const s0 = sql(stateQ);
  check("PRECONDITION: both classes active, 2 sessions, 1 substitute today, 1 open shadow, the DONE child present",
    a0 === ACTIVE_BOTH && s0 === STATE0, `${a0} | ${s0}`);
  check("PRECONDITION: both classes run on today's weekday, the DONE lesson is 7 days ago",
    sql(`SELECT count(*) FROM classes WHERE tenant_id = '${TENANT}'
          AND day_of_week = lower(trim(to_char(today_sg(), 'FMDay')))::day_of_week`) === "2"
      && sql(`SELECT (today_sg() - 7)::text`) === doneDate,
    `today=${todaySg} done=${doneDate} heading="${doneHeading}"`);

  // ── 1. The SUBSTITUTE: Covering + Mark Attendance ─────────────────────────
  let page = await openCoach("coach-sched-sub@swimsync.test");
  let t = await screenUntil(page, (x) => todayCard(x, T_COV) !== "");
  let card = todayCard(t, T_COV);
  check("sub: TODAY holds only the lesson they cover (1 lesson, no Shadowed card)",
    lessonCount(t) === "1 lesson" && todayCard(t, T_SH) === "", `${lessonCount(t)} | ${oneLine(card)}`);
  check("⚠ sub: the Covered card is badged 'Covering'",
    /\nCovering\n/.test(`\n${card}\n`) && !/Covered\n|Shadowing/.test(card), oneLine(card));
  check("sub: …with the loud 'Mark Attendance' button (a cover may mark)",
    card.includes("Mark Attendance") && !card.includes("View lesson"), oneLine(card));
  check("sub: one location in their week → NO location chips", !t.includes("All locations"));
  await opened.pop().browser.close();

  // ── 2. The SHADOW: Shadowing + View lesson ────────────────────────────────
  page = await openCoach("coach-sched-shadow@swimsync.test");
  t = await screenUntil(page, (x) => todayCard(x, T_SH) !== "");
  card = todayCard(t, T_SH);
  check("shadow: TODAY holds only the class they shadow (1 lesson, no Covered card)",
    lessonCount(t) === "1 lesson" && todayCard(t, T_COV) === "", `${lessonCount(t)} | ${oneLine(card)}`);
  check("⚠ shadow: the Shadowed card is badged 'Shadowing'",
    /\nShadowing\n/.test(`\n${card}\n`), oneLine(card));
  check("shadow: …with 'View lesson', never 'Mark Attendance' (the DB refuses a shadow's write)",
    card.includes("View lesson") && !card.includes("Mark Attendance"), oneLine(card));
  await opened.pop().browser.close();

  // ── 3. The OWNER: Covered + View lesson; the plain class unbadged ─────────
  page = await openCoach("coach-sched-owner@swimsync.test");
  t = await screenUntil(page, (x) => todayCard(x, T_COV).includes("Covered") && todayCard(x, T_SH) !== "");
  card = todayCard(t, T_COV);
  const plain = todayCard(t, T_SH);
  check("owner: TODAY holds both classes (2 lessons)", lessonCount(t) === "2 lessons", lessonCount(t));
  check("⚠ owner: the lesson a substitute covers is badged 'Covered'",
    /\nCovered\n/.test(`\n${card}\n`) && !/Covering|Shadowing/.test(card), oneLine(card));
  check("owner: …with 'View lesson' (the substitute marks it, not the owner)",
    card.includes("View lesson") && !card.includes("Mark Attendance"), oneLine(card));
  check("owner: their ordinary lesson has NO badge and 'Mark Attendance'",
    !/Covered|Covering|Shadowing/.test(plain) && plain.includes("Mark Attendance"), oneLine(plain));

  // ── 4. The location chips ─────────────────────────────────────────────────
  check("owner: two locations → chips 'All locations', North, South",
    /\nAll locations\nCoachSched North\nCoachSched South\n/.test(t), oneLine(t.slice(0, 200)));
  // The chips precede the cards in the DOM, so index 0 of the exact label is the chip.
  if (!(await pressByText(page, SOUTH, 0))) throw new Error("the South chip was not pressable");
  t = await screenUntil(page, (x) => lessonCount(x) === "1 lesson");
  check("chip South → TODAY holds only the South class",
    lessonCount(t) === "1 lesson" && todayCard(t, T_SH) !== "" && todayCard(t, T_COV) === "",
    `${lessonCount(t)} | ${oneLine(t.slice(t.indexOf("TODAY ·"), t.indexOf("TODAY ·") + 120))}`);
  if (!(await pressByText(page, NORTH, 0))) throw new Error("the North chip was not pressable");
  t = await screenUntil(page, (x) => lessonCount(x) === "1 lesson" && todayCard(x, T_COV) !== "");
  check("chip North → TODAY holds only the North class",
    lessonCount(t) === "1 lesson" && todayCard(t, T_COV) !== "" && todayCard(t, T_SH) === "",
    `${lessonCount(t)} | ${oneLine(t.slice(t.indexOf("TODAY ·"), t.indexOf("TODAY ·") + 120))}`);

  // ── 5. The clamp: North loses its only class while North is selected ─────
  try {
    clampTouched = true;
    sql(`UPDATE classes SET is_active = false, deactivated_at = now() WHERE id = '${COVERED}'`);
    check("DB: the North class is retired (is_active false, deactivated_at set)",
      sql(activeQ) === `${T_COV}:false:false,${T_SH}:true:true`, sql(activeQ));
    t = await refocusSchedule(page, (x) => todayCard(x, T_SH) !== "");
    check("⚠ clamp: one location left → the chips are gone",
      !t.includes("All locations") && !new RegExp(`\\n${NORTH}\\n${SOUTH}\\n`).test(t), oneLine(t.slice(0, 200)));
    check("⚠ clamp: the week renders UNFILTERED — the South class shows though North was selected",
      lessonCount(t) === "1 lesson" && todayCard(t, T_SH) !== "" && todayCard(t, T_COV) === "",
      `${lessonCount(t)} | ${oneLine(todayCard(t, T_SH))}`);
  } finally {
    if (clampTouched) {
      sql(`UPDATE classes SET is_active = true, deactivated_at = NULL WHERE id = '${COVERED}'`);
    }
  }
  check("DB: the North class is restored (both classes active, no deactivated_at)",
    sql(activeQ) === ACTIVE_BOTH, sql(activeQ));
  clampTouched = false;
  // The clamp is render-time: the SELECTED chip (North) was never cleared, so
  // once North has a lesson again the filter applies again.
  t = await refocusSchedule(page, (x) => x.includes("All locations") && todayCard(x, T_COV) !== "");
  check("after the restore the chips return, still filtered to North (clamped, not cleared)",
    t.includes("All locations") && lessonCount(t) === "1 lesson" && todayCard(t, T_SH) === "", lessonCount(t));
  if (!(await pressByText(page, "All locations"))) throw new Error("the All locations chip was not pressable");
  t = await screenUntil(page, (x) => lessonCount(x) === "2 lessons");
  check("chip 'All locations' → TODAY holds both lessons again", lessonCount(t) === "2 lessons", lessonCount(t));

  // ── 6. A DONE row tap ─────────────────────────────────────────────────────
  if (!(await pressTestId(page, "week-prev"))) throw new Error("week-prev was not pressable");
  t = await screenUntil(page, (x) => x.includes("Last week") && /\nDONE\n/.test(x) && x.includes(doneHeading));
  check("last week: a DONE section with the lesson day, and no NEEDS MARKING",
    t.includes("Last week") && /\nDONE\n/.test(t) && t.includes(`\n${doneHeading}\n`) && !/NEEDS MARKING/i.test(t),
    oneLine(t.slice(t.indexOf("Last week"), t.indexOf("Last week") + 160)));
  if (!(await pressByText(page, doneHeading))) throw new Error(`the DONE day "${doneHeading}" was not pressable`);
  t = await screenUntil(page, (x) => x.includes(`\n${T_SH}\n`) && x.includes("Marked"));
  const doneSeg = t.slice(t.indexOf(`\n${T_SH}\n`), t.indexOf("\nSchedule\n"));
  check("the expanded DONE day lists the Shadowed lesson as Marked (1 present)",
    /Marked/.test(doneSeg) && /1 present/.test(doneSeg), oneLine(doneSeg));
  if (!(await pressByText(page, T_SH))) throw new Error("the DONE row was not pressable");
  const want = `/classes/${SHADOWED}/attendance?date=${doneDate}&from=schedule`;
  // Wait for the marking screen, then read the URL it was reached by.
  t = await screenUntil(page, (x) => x.includes("CoachSched Shadowkid") && x.includes(`${T_SH} · `));
  const u = new URL(page.url());
  const got = u.pathname + u.search;
  check("⚠ the DONE tap opens EXACTLY /classes/<Shadowed>/attendance?date=<that day>&from=schedule",
    got === want, got);
  check("…and the marking screen shows that lesson (its class, its child)",
    t.includes(`${T_SH} · `) && t.includes("CoachSched Shadowkid"), oneLine(t.slice(0, 120)));
  const s1 = sql(stateQ);
  check("DB: opening the lesson wrote nothing (sessions, roster, shadow, attendance unchanged)",
    s1 === STATE0, s1);
  check("no dialog fired anywhere in the run", dialogs.length === 0, dialogs.join(" / "));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  // A throw between the retire and its own finally cannot happen (the
  // restore sits in one), but a throw INSIDE the restore would leave it
  // retired: try once more, loudly.
  if (clampTouched) {
    try { sql(`UPDATE classes SET is_active = true, deactivated_at = NULL WHERE id = '${COVERED}'`); }
    catch (e) { console.log(`✗ could not restore ${COVERED}: ${String(e).split("\n")[0]}`); process.exitCode = 1; }
  }
  const shotDir = process.env.SHOT_DIR;
  for (const b of opened) {
    if (shotDir) await b.page.screenshot({ path: `${shotDir}/coach-schedule-roles-final.png`, fullPage: true }).catch(() => {});
    await b.browser.close().catch(() => {});
  }
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
