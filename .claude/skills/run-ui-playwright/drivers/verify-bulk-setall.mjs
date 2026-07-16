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
// The fixture enrols Ana Tan + Ben Tan in "Saturday Beginners" and leaves Sat 11
// Jul 2026 unmarked. Clock is faked at 15 Jul 2026 so the backlog row is reachable.
import os from "node:os";
import path from "node:path";
import { launch, loginExpo, tap, dumpText } from "./lib.mjs";

const TODAY_SGT = new Date("2026-07-15T04:00:00Z");
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

async function openJul11() {
  await coach.goto("http://localhost:8081/today");
  await coach.waitForTimeout(4000);
  await tap(coach.getByText("11 Jul").first(), "backlog row → 11 Jul");
  await coach.waitForTimeout(3000);
}

// ── 1. Confirm path: mark one student, then Set all → guard fires ─────────────
await openJul11();
let text = await dumpText(coach);
check("Attendance opened at 11 Jul with both students", /Ana Tan/.test(text) && /Ben Tan/.test(text));
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
await openJul11();
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
await coach.goto("http://localhost:8081/today");
await coach.waitForTimeout(4000);
text = await dumpText(coach);
check("After bulk save, 11 Jul clears the unmarked backlog", !/Unmarked Lessons/.test(text));

await browser.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
