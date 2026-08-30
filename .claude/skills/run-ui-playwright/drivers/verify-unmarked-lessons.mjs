// Unmarked-lessons backlog + admin pre-generation coverage check.
//
// Proves the hole this feature closes: a lesson the coach never marked has no
// lesson_sessions row, so before this feature it was invisible to everyone and
// silently unbilled.
//
// Setup (from repo root):
//   supabase db reset
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-unmarked-lessons.sql
//   cd SwimSyncAdmin && npm run dev          # :3000
//   cd SwimSyncApp   && npx expo start --web # :8081
//
// The fixture leaves the MOST RECENT past Saturday unmarked (the one before it
// is fully marked). No date is written down here; all four labels are derived
// from the row the fixture wrote.
//
// ⚠ THE COMMENT THAT USED TO BE HERE HAD IT EXACTLY BACKWARDS. It read: "Both
// browsers run with a FAKED clock at 15 Jul 2026 so this keeps working whatever
// today's real date is — a real clock would make it rot immediately." The fake
// is what made it rot. `clock.install` is CLIENT-side; the backlog's lower bound
// is `markable_floor`, which Postgres computes from the REAL clock as the 1st of
// last month. Freezing the client pins one end of a comparison whose other end
// keeps moving, so a July fixture was guaranteed to fall out of the window on
// 2026-09-01 — silently, since an empty backlog renders as a normal screen.
// Simulated before the fix: 12/12 at a 2026-07-01 floor, 10/12 at 2026-08-01.
// §7.226.
//
// The fake is KEPT, because pinning the weekday is what makes the run identical
// on any day — but it is derived: the Wednesday after the missing Saturday.
//
// Run order matters: the admin gap check runs BEFORE the coach fixes the gap.
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { launch, loginExpo, loginAdmin, tap, dumpText } from "./lib.mjs";

const sql = (q) =>
  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -tAc ${JSON.stringify(
      q.replace(/\s+/g, " ").trim()
    )}`,
    { encoding: "utf8" }
  ).trim();

// Every label this driver asserts on, derived from the one row the fixture wrote.
// 'Dy, FMDD Mon' matches how the app renders a dated backlog row ("Sat, 4 Jul").
const [missingIso, MISSING, MARKED_ROW, NEXT_1, NEXT_2] = sql(`
  SELECT to_char(ls.session_date + 7,'YYYY-MM-DD')
      || '|' || to_char(ls.session_date + 7,'FMDD Mon')
      || '|' || to_char(ls.session_date,    'Dy, FMDD Mon')
      || '|' || to_char(ls.session_date + 14,'FMDD Mon')
      || '|' || to_char(ls.session_date + 21,'FMDD Mon')
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
   WHERE c.title = 'Saturday Beginners'
   ORDER BY ls.session_date DESC LIMIT 1`).split("|");

// The Wednesday after the missing Saturday, so NEXT_1/NEXT_2 stay in the future.
const TODAY_SGT = new Date(`${missingIso}T04:00:00Z`);
TODAY_SGT.setUTCDate(TODAY_SGT.getUTCDate() + 4);
console.log(`scenario: missing "${MISSING}", marked "${MARKED_ROW}", future "${NEXT_1}"/"${NEXT_2}"`);

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (name) => path.join(SHOT, name);

const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const { browser } = await launch();

// ── 1. Admin sees the gap BEFORE generating ──────────────────────────────────
const adminCtx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  timezoneId: "Asia/Singapore",
});
await adminCtx.clock.install({ time: TODAY_SGT });
const admin = await adminCtx.newPage();
// coach@swimsync.test is the TENANT admin (superadmin@ became the cross-tenant
// platform admin on 2026-07-19 and is refused the tenant pages — §8.7).
await loginAdmin(admin, "coach@swimsync.test", "password123");

async function openCoverageModal() {
  await admin.goto("http://localhost:3000/invoices");
  await admin.waitForTimeout(2500);
  await admin.fill('input[type="month"]', "2026-07");
  await admin.waitForTimeout(500);
  await admin.getByRole("button", { name: /Generate Invoices/i }).click();
  await admin.waitForTimeout(3000);
  return admin.innerText("body");
}

let adminText = await openCoverageModal();
await admin.screenshot({ path: shot("admin-modal-gap.png"), fullPage: true });

check("Admin modal warns lessons are unmarked", /no attendance marked/i.test(adminText));
check("Admin modal reports 1 of 2 lessons marked", /1 of 2 lessons marked/.test(adminText));
check("Admin modal names the missing date", new RegExp(`Missing:.*${MISSING}`).test(adminText));
// "Generate anyway" existed briefly before §8a made unmarked attendance a HARD
// block with no override (an override can only produce a permanent underbill).
// Its ABSENCE is now the product rule this modal must obey — asserting its
// presence was rot from the pre-hard-block era (repaired 2026-08-05).
check("No 'Generate anyway' override exists — the block is hard (§8a)",
  !/Generate anyway/i.test(adminText));
// The next two Saturdays are future and must not be called missing.
check("Future Saturdays are not reported as gaps",
  !new RegExp(`${NEXT_1}|${NEXT_2}`).test(adminText));

// ── 2. Coach sees the forgotten lesson ───────────────────────────────────────
const coachCtx = await browser.newContext({
  viewport: { width: 420, height: 900 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "Asia/Singapore",
});
await coachCtx.clock.install({ time: TODAY_SGT });
const coach = await coachCtx.newPage();
coach.on("dialog", (d) => d.accept());
await loginExpo(coach, "coach@swimsync.test", "password123");
await coach.waitForTimeout(3000);

let text = await dumpText(coach);
await coach.screenshot({ path: shot("coach-today-backlog.png"), fullPage: true });
check("Schedule lists one unmarked lesson", /NEEDS MARKING \(1\)/i.test(text));
check("Backlog names the forgotten Saturday", new RegExp(MISSING).test(text));
check("Backlog omits the already-marked Saturday", !new RegExp(MARKED_ROW).test(text));

// ── 3. Coach marks it from the backlog (the route that didn't exist before) ──
await tap(coach.getByText(MISSING).first(), "backlog row");
await coach.waitForTimeout(3000);
text = await dumpText(coach);
check("Backlog opens attendance at that date",
  new RegExp(`date=${missingIso}`).test(coach.url()), coach.url());
check("Enrolled students are listed", /Ana Tan/.test(text) && /Ben Tan/.test(text));

const present = coach.getByText("Present");
for (let i = 0, n = await present.count(); i < n; i++) await tap(present.nth(i), "Present");
await coach.waitForTimeout(500);
await tap(coach.getByText(/Save/).first(), "Save");
await coach.waitForTimeout(4000);

// ── 4. Backlog clears, admin goes green ──────────────────────────────────────
await coach.goto("http://localhost:8081/schedule");
await coach.waitForTimeout(4000);
text = await dumpText(coach);
await coach.screenshot({ path: shot("coach-today-cleared.png"), fullPage: true });
check("Backlog clears once marked", !/NEEDS MARKING/i.test(text));

adminText = await openCoverageModal();
await admin.screenshot({ path: shot("admin-modal-clear.png"), fullPage: true });
check("Admin modal reports all-clear once marked", /fully marked/.test(adminText));

await browser.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
