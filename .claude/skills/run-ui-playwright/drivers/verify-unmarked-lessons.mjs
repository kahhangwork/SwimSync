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
// The fixture leaves Sat 11 Jul 2026 unmarked (Sat 4 Jul is fully marked) and
// pins enrolment to 1 Jul. Both browsers run with a FAKED clock at 15 Jul 2026
// so this keeps working whatever today's real date is — the backlog window is
// "since the previous month", so a real clock would make it rot immediately.
//
// Run order matters: the admin gap check runs BEFORE the coach fixes the gap.
import os from "node:os";
import path from "node:path";
import { launch, loginExpo, loginAdmin, tap, dumpText } from "./lib.mjs";

// Wed 15 Jul 2026, 12:00 SGT. July's Saturdays so far: the 4th and the 11th.
const TODAY_SGT = new Date("2026-07-15T04:00:00Z");

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
await loginAdmin(admin, "superadmin@swimsync.test", "password123");

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
check("Admin modal names the missing date", /Missing:.*11 Jul/.test(adminText));
check("Confirm button reworded to 'Generate anyway'", /Generate anyway/.test(adminText));
// Today is 15 Jul: the 18th and 25th are future and must not be called missing.
check("Future Saturdays are not reported as gaps", !/18 Jul|25 Jul/.test(adminText));

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
check("Today lists one unmarked lesson", /Unmarked Lessons \(1\)/.test(text));
check("Backlog names the forgotten Saturday", /11 Jul/.test(text));
check("Backlog omits the already-marked Saturday", !/Sat, 4 Jul/.test(text));

// ── 3. Coach marks it from the backlog (the route that didn't exist before) ──
await tap(coach.getByText("11 Jul").first(), "backlog row");
await coach.waitForTimeout(3000);
text = await dumpText(coach);
check("Backlog opens attendance at that date", /date=2026-07-11/.test(coach.url()));
check("Enrolled students are listed", /Ana Tan/.test(text) && /Ben Tan/.test(text));

const present = coach.getByText("Present");
for (let i = 0, n = await present.count(); i < n; i++) await tap(present.nth(i), "Present");
await coach.waitForTimeout(500);
await tap(coach.getByText(/Save/).first(), "Save");
await coach.waitForTimeout(4000);

// ── 4. Backlog clears, admin goes green ──────────────────────────────────────
await coach.goto("http://localhost:8081/today");
await coach.waitForTimeout(4000);
text = await dumpText(coach);
await coach.screenshot({ path: shot("coach-today-cleared.png"), fullPage: true });
check("Backlog clears once marked", !/Unmarked Lessons/.test(text));

adminText = await openCoverageModal();
await admin.screenshot({ path: shot("admin-modal-clear.png"), fullPage: true });
check("Admin modal reports all-clear once marked", /fully marked/.test(adminText));

await browser.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
