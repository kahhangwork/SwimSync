// Advance-cancel a lesson (cancel_lesson / restore_lesson, 20260821000700) through
// the real UI — docs/plans/UPCOMING_LESSONS_COMPLETE_PLAN.md Phase B, Step B6.
//
// THE LOAD-BEARING ASSERTIONS:
//   • the admin cancels NEXT WEEK's Rose lesson from the lesson page with a
//     reason; the DB row carries status='cancelled' + cancelled_at + the reason
//     (read back through psql, not the page); Save / Set all / booking are
//     disabled and "Restore" replaces "Cancel";
//   • the read-only calendar's day view shows that lesson with a "Cancelled" chip;
//   • the Classes page's "Cancel a lesson" entry, used on a PAST date, renders the
//     RPC's own refusal ("has not happened yet") — the rule lives in the DB
//     (§7.32), the page only repeats it;
//   • the coach app's Schedule shows next week's Rose card struck "Cancelled by
//     your admin" (the cosmetic half of §7.204; the trigger is the load-bearing
//     half, pinned in pgTAP);
//   • Restore clears the flag: the banner goes, Cancel is offered again, the DB
//     row is a plain scheduled session.
//
// Setup: supabase + seed; fixtures-admin-calendar.sql loaded (Rose runs on
// TODAY's weekday, so today+7 is a real future Rose lesson); admin dev on :3000;
// Expo web on :8081 for the coach check. RE-RUNNABLE: the finally block deletes
// the bare session row the cancel created (restore leaves the row, flag
// cleared), so the fixture's session count is unchanged afterwards.
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { launch, loginAdmin, loginExpo, gotoAuthed, tap, dumpText, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (l, p, d = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
};
const sql = (q) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -Atc "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();

const ROSE = "ca1c1a55-0000-0000-0000-000000000001";
const REASON = "Driver: pool closed for maintenance";

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const shift = (d, n) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const nextWeek = shift(today, 7);
const lastWeek = shift(today, -7);

const rowState = () =>
  sql(`SELECT status::text || ':' || (cancelled_at IS NOT NULL)::text || ':' || coalesce(cancellation_reason,'') FROM lesson_sessions WHERE class_id='${ROSE}' AND session_date='${nextWeek}'`);

const { browser, page } = await launch();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
  await loginAdmin(page, "coach@swimsync.test");

  // ── 1. Next week's Rose lesson: offered for cancel, not cancelled ──────────
  await page.goto(`${ADMIN}/lessons/${ROSE}/${nextWeek}`, { waitUntil: "networkidle" });
  await page.getByTestId("roster-row").first().waitFor({ timeout: 15000 });
  check("a FUTURE lesson offers 'Cancel this lesson' and shows no cancelled banner",
    (await page.getByTestId("cancel-lesson").count()) === 1 && (await page.getByTestId("lesson-cancelled").count()) === 0);
  check("DB: no session row exists yet for that date (rows are lazy)", rowState() === "", rowState());

  // ── 2. Cancel it, with a reason ───────────────────────────────────────────
  await page.getByTestId("cancel-lesson").click();
  await page.getByTestId("cancel-reason").waitFor({ timeout: 5000 });
  check("the confirm is disabled until a reason is typed", await page.getByTestId("confirm-cancel-lesson").isDisabled());
  await page.getByTestId("cancel-reason").fill(REASON);
  await page.screenshot({ path: shot("cancel-lesson-modal.png") });
  await page.getByTestId("confirm-cancel-lesson").click();
  await page.getByTestId("lesson-cancelled").waitFor({ timeout: 15000 });
  const banner = await page.getByTestId("lesson-cancelled").innerText();
  check("the page shows the cancelled banner with the reason", banner.includes(REASON), banner.slice(0, 120));
  check("Save is disabled, Restore is offered, Cancel is not",
    (await page.getByTestId("save-attendance").isDisabled()) &&
      (await page.getByTestId("restore-lesson").count()) === 1 &&
      (await page.getByTestId("cancel-lesson").count()) === 0);
  check("booking a guest into a cancelled lesson is disabled",
    await page.getByRole("button", { name: /Book a make-up into this lesson/ }).isDisabled());
  check("DB: status=cancelled, cancelled_at set, reason stored", rowState() === `cancelled:true:${REASON}`, rowState());
  await page.screenshot({ path: shot("cancel-lesson-cancelled.png"), fullPage: true });

  // ── 3. The read-only calendar shows it as Cancelled ───────────────────────
  await page.goto(`${ADMIN}/calendar?view=day&date=${nextWeek}`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-card").first().waitFor({ timeout: 15000 });
  const roseCard = page.getByTestId("lesson-card").filter({ hasText: "Cal Rose Full" }).first();
  check("calendar day view: the Rose card carries the Cancelled chip", /Cancelled/.test(await roseCard.innerText()));
  await page.screenshot({ path: shot("cancel-lesson-calendar.png") });

  // ── 4. Classes page entry, on a PAST date: the RPC refuses, the page repeats it ──
  await page.goto(`${ADMIN}/classes`, { waitUntil: "networkidle" });
  const roseRow = page.locator("tr", { hasText: "Cal Rose Full" }).first();
  await roseRow.getByTestId("cancel-lesson-entry").waitFor({ timeout: 15000 });
  await roseRow.getByTestId("cancel-lesson-entry").click();
  const dateInput = page.locator('input[type="date"]').last();
  await dateInput.waitFor({ timeout: 5000 });
  await dateInput.fill(lastWeek);
  await page.getByPlaceholder(/Heavy rain forecast/).fill("Driver: too late");
  await page.getByTestId("confirm-cancel-lesson").click();
  await page.getByTestId("cancel-error").waitFor({ timeout: 15000 });
  const err = await page.getByTestId("cancel-error").innerText();
  check("Classes → Cancel a lesson on a PAST date shows the RPC's 'has not happened yet' refusal (RISK 2)",
    /has not happened yet/.test(err) || /today or already past/.test(err), err.slice(0, 120));
  check("DB: the refused cancel wrote nothing for last week",
    sql(`SELECT count(*) FROM lesson_sessions WHERE class_id='${ROSE}' AND session_date='${lastWeek}' AND cancelled_at IS NOT NULL`) === "0");
  check("no uncaught page errors (admin)", pageErrors.length === 0, pageErrors.join(" || "));

  // ── 5. Coach app: next week's Schedule card is struck "Cancelled by your admin" ──
  // Navigated like a user (Schedule tab → next week), not deep-linked: a future
  // date never reaches the attendance screen (the Schedule card itself routes a
  // future lesson to the roster), and a deep link to a nested stack screen
  // resolves back to /schedule anyway (run-ui-playwright SKILL §4.3).
  const cctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const coach = await cctx.newPage();
  coach.on("dialog", (d) => d.accept().catch(() => {}));
  await loginExpo(coach, "coach@swimsync.test", "password123");
  await gotoAuthed(coach, `${EXPO}/schedule`);
  await coach.waitForTimeout(2500);
  await tap(coach.getByTestId("week-next"), "week-next");
  await coach.waitForTimeout(2500);
  // COMING UP renders each day COLLAPSED ("Fri, 28 Aug · 2 lessons"); the cards
  // only enter the DOM once the day header is expanded. Expand the fixture's
  // own day BY NAME (§7.101 — never `.last()` over a bare day-header regex),
  // and assert it matched before pressing (a `tap()` on an empty locator
  // throws and would silently shrink this driver's denominator, §7.100).
  const sgOpts = (o) => new Date(`${nextWeek}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Singapore", ...o });
  const dayHeader = new RegExp(`^${sgOpts({ weekday: "short" })},? ${sgOpts({ day: "numeric" })} ${sgOpts({ month: "short" })}$`);
  const header = coach.getByText(dayHeader);
  const headerCount = await header.count();
  check(`coach app: next week's COMING UP lists the fixture's day (${dayHeader})`, headerCount === 1, `matched ${headerCount}`);
  if (headerCount === 1) {
    await tap(header, "expand the coming-up day");
    await coach.waitForTimeout(2500);
  }
  const t = await dumpText(coach, 6000);
  await coach.screenshot({ path: shot("cancel-lesson-coach.png"), fullPage: true });
  check("coach app: next week's Rose card reads 'Cancelled by your admin'",
    /Next week/.test(t) && /Cal Rose Full/.test(t) && /Cancelled by your admin/.test(t),
    t.match(/.{0,60}Cancelled by your admin.{0,20}/)?.[0] ?? "(no 'Cancelled by your admin' text)");
  await cctx.close();

  // ── 6. Restore ────────────────────────────────────────────────────────────
  await page.goto(`${ADMIN}/lessons/${ROSE}/${nextWeek}`, { waitUntil: "networkidle" });
  await page.getByTestId("restore-lesson").waitFor({ timeout: 15000 });
  await page.getByTestId("restore-lesson").click();
  await page.getByTestId("cancel-lesson").waitFor({ timeout: 15000 });
  check("after Restore the banner is gone and Cancel is offered again",
    (await page.getByTestId("lesson-cancelled").count()) === 0 && (await page.getByTestId("cancel-lesson").count()) === 1);
  check("DB: the row is a plain scheduled session again", rowState() === "scheduled:false:", rowState());
  check("DB: one lesson_cancelled and one lesson_restored audit row",
    sql(`SELECT count(*) FILTER (WHERE action='lesson_cancelled') || '/' || count(*) FILTER (WHERE action='lesson_restored') FROM audit_log WHERE entity_type='lesson_session' AND entity_id=(SELECT id FROM lesson_sessions WHERE class_id='${ROSE}' AND session_date='${nextWeek}')`) === "1/1");
} finally {
  // Leave the fixture as it was: the cancel created a bare session row for
  // next week (restore keeps it, flag cleared) — remove it so the calendar
  // fixture's session count is unchanged for a sibling driver.
  try {
    sql(`DELETE FROM audit_log WHERE entity_type='lesson_session' AND entity_id IN (SELECT id FROM lesson_sessions WHERE class_id='${ROSE}' AND session_date='${nextWeek}')`);
    sql(`DELETE FROM lesson_sessions WHERE class_id='${ROSE}' AND session_date='${nextWeek}' AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = lesson_sessions.id)`);
    check("cleanup: next week's driver-created session row removed", rowState() === "", rowState());
  } catch (e) {
    check("cleanup: next week's driver-created session row removed", false, String(e).slice(0, 120));
  }
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
