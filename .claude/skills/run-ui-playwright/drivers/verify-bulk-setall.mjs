// Bulk "Set all to…" on the coach attendance screen (BACKLOG #1).
//
// Verifies the new header "Set all ▾" menu: the no-confirm path (fresh screen,
// one tap sets everyone), the confirm path (a guard fires when some students are
// already marked), that the dropdown overlay actually renders on RN-web (the main
// risk — absolute overlay + z-index is the "works on native, breaks on web"
// family), and that a bulk save persists the chosen status to the DB.
//
// Setup (from repo root):
//   supabase db reset
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-unmarked-lessons.sql
//   cd SwimSyncApp && npx expo start --web   # :8081
//
// The fixture enrols Ana Tan + Ben Tan in "Saturday Beginners" and leaves the
// MOST RECENT past Saturday unmarked. Nothing here states that date: it is read
// back off the row the fixture wrote, and the gap is exactly seven days later.
//
// ⚠ THIS USED TO SAY 15 Jul 2026, AND THAT IS A BUG THAT FIRES ON A CALENDAR.
// The clock fake is client-side only — it cannot fake `markable_floor`, which
// Postgres computes from the real clock as the 1st of LAST month. A frozen July
// client and a marching server floor agree until the floor passes the fixture's
// lessons, then the needs-marking backlog empties and every check here fails on
// a screen that looks perfectly normal. Simulated before the fix: 10/10 at a
// 2026-07-01 floor, 9/10 at 2026-08-01. §7.226.
//
// The fake is still needed — it pins the WEEKDAY so the run is identical on any
// day — but it is now DERIVED: the Wednesday after the missing Saturday, which
// keeps the next Saturday in the future so "must not be called missing" still
// means something.
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { launch, loginExpo, tap, dumpText } from "./lib.mjs";

const sql = (q) =>
  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -tAc ${JSON.stringify(
      q.replace(/\s+/g, " ").trim()
    )}`,
    { encoding: "utf8" }
  ).trim();

// The one row the fixture wrote is the single source of truth for the scenario.
const [markedIso, missingIso, missingLabel] = sql(`
  SELECT to_char(ls.session_date,'YYYY-MM-DD')
      || '|' || to_char(ls.session_date + 7,'YYYY-MM-DD')
      || '|' || to_char(ls.session_date + 7,'FMDD Mon')
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
   WHERE c.title = 'Saturday Beginners'
   ORDER BY ls.session_date DESC LIMIT 1`).split("|");

// The Wednesday after the missing Saturday.
const TODAY_SGT = new Date(`${missingIso}T04:00:00Z`);
TODAY_SGT.setUTCDate(TODAY_SGT.getUTCDate() + 4);
console.log(`scenario: marked ${markedIso}, missing ${missingIso} ("${missingLabel}")`);
const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (name) => path.join(SHOT, name);

const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const { browser } = await launch();

const coachCtx = await browser.newContext({
  viewport: { width: 420, height: 900 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "Asia/Singapore",
});
await coachCtx.clock.install({ time: TODAY_SGT });
const coach = await coachCtx.newPage();

const dialogs = [];
coach.on("dialog", (d) => {
  dialogs.push(d.message());
  d.accept().catch(() => {});
});

await loginExpo(coach, "coach@swimsync.test", "password123");
await coach.waitForTimeout(3000);

async function openMissingSaturday() {
  await coach.goto("http://localhost:8081/schedule");
  await coach.waitForTimeout(4000);
  await tap(coach.getByText(missingLabel).first(), `backlog row → ${missingLabel}`);
  await coach.waitForTimeout(3000);
}

// ── 1. Confirm path: mark one student, then Set all → guard fires ─────────────
await openMissingSaturday();
let text = await dumpText(coach);
check(`Attendance opened at ${missingLabel} with both students`, /Ana Tan/.test(text) && /Ben Tan/.test(text));
check("Both students start unmarked", (text.match(/Not yet marked/g) || []).length === 2);

// mark the first student's row Present manually
await tap(coach.getByText("Present").first(), "row Present (Ana)");
await coach.waitForTimeout(400);

const beforeConfirm = dialogs.length;
await tap(coach.getByText("Set all").first(), "Set all button");
await coach.waitForTimeout(600);
await coach.screenshot({ path: shot("setall-menu-open.png"), fullPage: true });
text = await dumpText(coach);
check("Dropdown menu renders all four options", /Cancelled — Rain/.test(text) && /Cancelled — Coach/.test(text));

await tap(coach.getByText("Cancelled — Coach").first(), "menu → Cancelled — Coach");
await coach.waitForTimeout(700);
check("Confirm guard fired when a student was already marked", dialogs.length === beforeConfirm + 1,
  dialogs[dialogs.length - 1] ?? "(no dialog)");
check("Confirm message names the count and status",
  /change all 2 students to Cancelled — Coach/i.test(dialogs[dialogs.length - 1] ?? ""));
text = await dumpText(coach);
check("After confirm, both rows are Cancelled (Coach)", !/Not yet marked/.test(text) && /Reason:/.test(text));

// ── 2. No-confirm path: fresh screen, one tap, no dialog ─────────────────────
// Navigate away WITHOUT saving, so 11 Jul reloads clean from the DB.
await openMissingSaturday();
text = await dumpText(coach);
check("Reopened 11 Jul is fresh again (nothing was saved)",
  (text.match(/Not yet marked/g) || []).length === 2);

const beforeNoConfirm = dialogs.length;
await tap(coach.getByText("Set all").first(), "Set all button");
await coach.waitForTimeout(500);
await tap(coach.getByText("Cancelled — Rain").first(), "menu → Cancelled — Rain");
await coach.waitForTimeout(700);
check("No confirm dialog on an all-unmarked screen", dialogs.length === beforeNoConfirm);
text = await dumpText(coach);
check("One tap set every student to Cancelled (Rain)",
  !/Not yet marked/.test(text) && /Reason:/.test(text));
await coach.screenshot({ path: shot("setall-cancelled-rain.png"), fullPage: true });

// ── 3. Save persists, and 11 Jul drops out of the unmarked backlog ───────────
// (A bulk-cancelled lesson counts as marked — every student has a row — so it
// clears the Today backlog. Asserting on the backlog avoids gotcha #6, where the
// mark screen stays mounted under Today and pollutes body.innerText.)
await tap(coach.getByText(/Save/).first(), "Save Attendance");
await coach.waitForTimeout(4000);
await coach.goto("http://localhost:8081/schedule");
await coach.waitForTimeout(4000);
text = await dumpText(coach);
check(`After bulk save, ${missingLabel} clears the unmarked backlog`, !/NEEDS MARKING/i.test(text));

await browser.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
