// The admin lesson page (/lessons/[classId]/[date]) and the Lessons list
// (/lessons), end to end through the real UI — plus the coach-app round trip.
//
// THE LOAD-BEARING ASSERTIONS:
//   • the admin's save lands as attendance rows AND an audit_log row with
//     action='attendance_saved' (the 20260819000100 policy arm — RISK 1), read
//     back through psql, not the page;
//   • a per-lesson Holiday goes through a confirm that names the count (RISK 4)
//     and is then LEFT UNTOUCHED by the coach app's own save (RISK 7);
//   • a lesson below the marking floor opens read-only for new rows, and
//     re-marking a row whose credit is already applied is refused with the
//     mapped CN001 message (RISK 2) — no retry, no override;
//   • an off-weekday date with no session is "not a lesson": no Save at all;
//   • assign / remove a substitute; a make-up into a FULL lesson is REFUSED by
//     the database (capacity is a HARD limit since 20260820000200 — no
//     "Book anyway"); after raising the class's maximum the guest appears x+1/cap;
//   • the Lessons list's Needs-marking mode lists the partial lesson and a row
//     click lands on the lesson page.
//
// Setup: supabase + seed; fixtures-admin-calendar.sql loaded; admin dev on :3000;
// Expo web on :8081 for the coach round trip. A RE-RUN NEEDS A FULL db reset, not
// just a fixture re-load: this driver books Delta into Rose and writes attendance
// through the UI, and the fixture's ON CONFLICT does not remove those. The
// capacity it raises IS restored in finally (and the fixture re-asserts it), so a
// sibling verify-admin-calendar after a fixture re-load reads Rose at 3/3 again.
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
const EMERALD = "ca1c1a55-0000-0000-0000-000000000002";
const ALPHA = "ca199999-0000-0000-0000-000000000001";
const BRAVO = "ca199999-0000-0000-0000-000000000002";
const CHARLIE = "ca199999-0000-0000-0000-000000000003";
const DELTA = "ca199999-0000-0000-0000-000000000004";

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const shift = (d, n) => {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
};
const lastWeek = shift(today, -7);
const cn001Date = shift(today, -140);
const tomorrow = shift(today, 1);

const { browser, page } = await launch();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
  await loginAdmin(page, "coach@swimsync.test");

  // ── Badge parity (§7.18, RISK 5): the sidebar Lessons badge (RPC
  // tenant_unmarked_lesson_count, the FULL markable-window backlog) MUST equal
  // the page's mode=needs row count (same backlog). Read BEFORE any marking
  // below changes N. NOTE the week-mode "Needs marking (N)" tab is deliberately
  // NOT compared: its needsCount is scoped to the current week's range, a
  // legitimately different number from the full-window badge. (Nightly runs
  // ~04:30 SGT, before the fixture lessons' 11:00/11:30 end — no clock flake.)
  await page.goto(`${ADMIN}/lessons`, { waitUntil: "networkidle" });
  await page.getByTestId("needs-marking-toggle").waitFor({ timeout: 15000 });
  const badgeEl = page.locator('[title*="still need"][title*="marking"]');
  const badgeN = (await badgeEl.count()) > 0 ? parseInt((await badgeEl.first().innerText()).trim(), 10) : 0;
  await page.goto(`${ADMIN}/lessons?mode=needs`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-row").first().waitFor({ timeout: 15000 });
  const rowN = await page.getByTestId("lesson-row").count();
  check(
    `Lessons sidebar badge == mode=needs page rows, and >= 1 (§7.18: badge ${badgeN} / rows ${rowN})`,
    badgeN === rowN && rowN >= 1,
  );

  // ── Lessons list: Needs marking lists the partial lesson; a row opens it ──
  await page.goto(`${ADMIN}/lessons?mode=needs`, { waitUntil: "networkidle" });
  await page.getByTestId("lesson-row").first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: shot("admin-lessons-needs.png") });
  const needsRows = page.getByTestId("lesson-row").filter({ hasText: "Cal Rose Full" });
  check("Lessons · Needs marking lists last week's partly-marked Rose lesson", (await needsRows.count()) >= 1);
  const roseLastWeekRow = page.locator(`a[href="/lessons/${ROSE}/${lastWeek}"]`);
  check("…as a row linking to /lessons/<class>/<date>", (await roseLastWeekRow.count()) === 1);
  await roseLastWeekRow.first().click();
  await page.waitForURL(`**/lessons/${ROSE}/${lastWeek}`, { timeout: 10000 });
  await page.getByTestId("roster-row").first().waitFor({ timeout: 15000 });

  // ── Lesson page, last week's Rose: 3 rows, Alpha present, Bravo absent, Charlie unmarked ──
  await page.screenshot({ path: shot("admin-lesson-rose-lastweek.png"), fullPage: true });
  // Statuses are BUTTONS (the coach app's shape): the pressed one carries the value.
  const statusOf = async (sid) => {
    const pressed = page.locator(`[data-testid="roster-row"][data-student="${sid}"] [data-status][aria-pressed="true"]`);
    if ((await pressed.count()) === 0) return "";
    // The most specific pressed button (a reason like cancelled_rain beats "cancelled")
    const vals = await pressed.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
    return vals.find((v) => v.includes("_")) ?? vals[0];
  };
  const setStatus = (sid, status) => page.locator(`[data-testid="roster-row"][data-student="${sid}"] [data-status="${status}"]`).click();
  const statusDisabled = (sid) => page.locator(`[data-testid="roster-row"][data-student="${sid}"] [data-status="present"]`).isDisabled();
  check("roster shows the three enrolled children with their marks", (await page.getByTestId("roster-row").count()) === 3);
  check("Alpha present, Bravo absent, Charlie unmarked (as loaded)", (await statusOf(ALPHA)) === "present" && (await statusOf(BRAVO)) === "absent" && (await statusOf(CHARLIE)) === "");
  check("Save is disabled until something changes", await page.getByTestId("save-attendance").isDisabled());

  // Mark: Bravo → present, Charlie → present, Alpha → holiday (confirm)
  await setStatus(BRAVO, "present");
  await setStatus(CHARLIE, "present");
  await setStatus(ALPHA, "holiday");
  await page.getByTestId("save-attendance").click();
  const confirmBtn = page.getByTestId("confirm-holiday");
  await confirmBtn.waitFor({ timeout: 5000 });
  const confirmText = await page.getByText(/Void as a public holiday/).locator("..").innerText().catch(() => "");
  check("a Holiday transition asks for confirmation naming the count", /1/.test(await confirmBtn.innerText()), await confirmBtn.innerText());
  await page.screenshot({ path: shot("admin-lesson-holiday-confirm.png") });
  await confirmBtn.click();
  await page.getByTestId("save-message").waitFor({ timeout: 15000 });
  const saveMsg = await page.getByTestId("save-message").innerText();
  check("save reports the marks written", /Saved 3 marks/.test(saveMsg), saveMsg);

  const dbStatuses = sql(`SELECT string_agg(a.student_id::text || ':' || a.status, ',' ORDER BY a.student_id) FROM attendance a JOIN lesson_sessions ls ON ls.id=a.lesson_session_id WHERE ls.class_id='${ROSE}' AND ls.session_date='${lastWeek}'`);
  check("DB: Alpha holiday, Bravo present, Charlie present", dbStatuses === `${ALPHA}:holiday,${BRAVO}:present,${CHARLIE}:present`, dbStatuses);
  const auditRows = sql(`SELECT count(*) FROM audit_log al JOIN lesson_sessions ls ON ls.id=al.entity_id WHERE al.entity_type='lesson_session' AND al.action='attendance_saved' AND ls.class_id='${ROSE}' AND ls.session_date='${lastWeek}' AND al.new_value->>'actor_role'='admin'`);
  check("DB: an audit_log attendance_saved row exists for the admin's save (RISK 1)", auditRows === "1", `rows=${auditRows}`);

  // ── The audit page shows the admin's mark ────────────────────────────────
  await page.goto(`${ADMIN}/attendance`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const searchBox = page.locator('input[type="search"], input[placeholder*="earch"]').first();
  if ((await searchBox.count()) > 0) {
    await searchBox.fill("Calkid Charlie");
    await page.waitForTimeout(800);
  }
  const auditText = await page.locator("body").innerText();
  check("/attendance audit page lists the admin-marked row", /Calkid Charlie/.test(auditText));

  // ── Below the floor: read-only for new rows; CN001 refusal with the mapped message ──
  await page.goto(`${ADMIN}/lessons/${ROSE}/${cn001Date}`, { waitUntil: "networkidle" });
  await page.getByTestId("roster-row").first().waitFor({ timeout: 15000 });
  const mark = await page.getByTestId("markability").innerText().catch(() => "");
  check("a lesson below the floor shows the closed-window banner", /closed/i.test(mark), mark.slice(0, 80));
  // Nobody was enrolled 20 weeks back (the fixture back-dates enrolments 30
  // days), so the only row is Bravo's billed mark — shown because a marked row
  // is a correction, and corrections stay editable below the floor.
  check("the billed row (Bravo, absent) is shown and editable as a correction", (await page.getByTestId("roster-row").count()) === 1 && !(await statusDisabled(BRAVO)));
  await setStatus(BRAVO, "present");
  await page.getByTestId("save-attendance").click();
  await page.getByTestId("save-message").waitFor({ timeout: 15000 });
  const cnMsg = await page.getByTestId("save-message").innerText();
  check("re-marking a row whose credit is applied is refused with the CN001 message (RISK 2)", /credit was already applied/.test(cnMsg) && /None of your changes were saved/.test(cnMsg), cnMsg.slice(0, 100));
  const bravoStill = sql(`SELECT a.status FROM attendance a JOIN lesson_sessions ls ON ls.id=a.lesson_session_id WHERE ls.class_id='${ROSE}' AND ls.session_date='${cn001Date}' AND a.student_id='${BRAVO}'`);
  check("DB: the refused row is unchanged (absent)", bravoStill === "absent", bravoStill);
  await page.screenshot({ path: shot("admin-lesson-cn001.png"), fullPage: true });

  // ── Not a lesson: off-weekday date with no session ───────────────────────
  await page.goto(`${ADMIN}/lessons/${ROSE}/${tomorrow}`, { waitUntil: "networkidle" });
  await page.getByTestId("not-a-lesson").waitFor({ timeout: 15000 });
  check("an off-weekday date with no session is refused as not a lesson, with no Save", (await page.getByTestId("save-attendance").count()) === 0);

  // ── Substitute: assign then remove (Rose, today) ─────────────────────────
  await page.goto(`${ADMIN}/lessons/${ROSE}/${today}`, { waitUntil: "networkidle" });
  await page.getByTestId("roster-row").first().waitFor({ timeout: 15000 });
  await page.getByLabel("Substitute coach").selectOption({ label: "Calendar Sub" });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await page.waitForTimeout(2500);
  let body = await page.locator("body").innerText();
  check("assigning a substitute shows them as Teaching … (Sub)", /Teaching:\s*Calendar Sub/.test(body) && /\(Sub\)/.test(body));
  await page.getByText(/Remove the assigned coach/).click();
  await page.waitForTimeout(2500);
  body = await page.locator("body").innerText();
  check("removing it returns to the class's own coach", /Teaching:\s*Coach Marcus/.test(body));

  // ── Book a make-up into the FULL Rose lesson: the DATABASE refuses ────────
  // Capacity is a hard limit (20260820000200); there is no "Book anyway".
  check("Rose today reads 3/3 · FULL", /3\/3/.test(await page.getByTestId("lesson-count").innerText()));
  await page.getByRole("button", { name: /Book a make-up into this lesson/ }).click();
  await page.getByLabel("Child", { exact: true }).waitFor({ timeout: 5000 });
  await page.getByLabel("Child", { exact: true }).selectOption(DELTA);
  await page.getByTestId("book-guest").click();
  await page.waitForTimeout(2000);
  let bookBody = await page.locator("body").innerText();
  check(
    "a make-up into a full lesson is REFUSED by the DB — sentence shown, no 'Book anyway', guest not added, still 3/3",
    /is full on .*\(3 of 3\)/.test(bookBody) &&
      (await page.getByTestId("book-anyway").count()) === 0 &&
      (await page.locator(`[data-testid="roster-row"][data-student="${DELTA}"]`).count()) === 0 &&
      /3\/3/.test(await page.getByTestId("lesson-count").innerText()),
    bookBody.replace(/\s+/g, " ").slice(0, 160),
  );
  // Raise Rose's maximum; the booking now succeeds -> 3+1/4 (the always-open exit).
  sql(`UPDATE classes SET capacity = 4 WHERE id='${ROSE}'`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Book a make-up into this lesson/ }).click();
  await page.getByLabel("Child", { exact: true }).waitFor({ timeout: 5000 });
  await page.getByLabel("Child", { exact: true }).selectOption(DELTA);
  await page.getByTestId("book-guest").click();
  await page.waitForTimeout(2500);
  const deltaRow = page.locator(`[data-testid="roster-row"][data-student="${DELTA}"]`);
  check("after raising the maximum, the make-up guest appears with a Make-up chip", (await deltaRow.count()) === 1 && /Make-up/i.test(await deltaRow.innerText()));
  check("the count becomes 3+1/4", /3\+1\/4/.test(await page.getByTestId("lesson-count").innerText()), await page.getByTestId("lesson-count").innerText());
  await page.screenshot({ path: shot("admin-lesson-rose-today.png"), fullPage: true });

  check("no uncaught page errors (admin)", pageErrors.length === 0, pageErrors.join(" || "));

  // ══════════════ COACH ROUND TRIP (RISK 7) ══════════════
  // The class's own coach opens last week's Rose lesson in the coach app: the
  // admin's marks show, the coach saves, and the admin's HOLIDAY row survives.
  const cctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const coach = await cctx.newPage();
  coach.on("dialog", (d) => d.accept().catch(() => {}));
  await loginExpo(coach, "coach@swimsync.test", "password123");
  await gotoAuthed(coach, `${EXPO}/(coach)/classes/${ROSE}/attendance?date=${lastWeek}`);
  await coach.waitForTimeout(3500);
  const t = await dumpText(coach);
  await coach.screenshot({ path: shot("coach-rose-lastweek.png"), fullPage: true });
  check("coach app shows the admin-marked roster", /Calkid Bravo/.test(t) && /Calkid Charlie/.test(t));
  check("coach app shows the admin's holiday mark on Alpha", /holiday/i.test(t), t.match(/.{0,40}holiday.{0,40}/i)?.[0] ?? "(no 'holiday' text)");
  await tap(coach.getByText(/Save/).first(), "Save Attendance");
  await coach.waitForTimeout(4000);
  const afterCoach = sql(`SELECT a.status FROM attendance a JOIN lesson_sessions ls ON ls.id=a.lesson_session_id WHERE ls.class_id='${ROSE}' AND ls.session_date='${lastWeek}' AND a.student_id='${ALPHA}'`);
  check("DB: the coach's save left the admin's holiday row untouched (RISK 7)", afterCoach === "holiday", afterCoach);
  await cctx.close();
} finally {
  // Restore Rose to its fixture state (RISK 4): capacity 3 and no driver-booked
  // Delta guest, so a sibling verify-admin-calendar after a fixture re-load reads
  // 3/3 · FULL even if this run crashed mid-way.
  try {
    sql(`UPDATE classes SET capacity = 3 WHERE id='${ROSE}'`);
    sql(`DELETE FROM makeup_bookings WHERE class_id='${ROSE}' AND student_id='${DELTA}'`);
    const roseCap = sql(`SELECT capacity FROM classes WHERE id='${ROSE}'`);
    check("cleanup: Rose restored to capacity 3, driver-booked guest removed", roseCap === "3", roseCap);
  } catch (e) {
    check("cleanup: Rose restored to capacity 3, driver-booked guest removed", false, String(e).slice(0, 120));
  }
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
