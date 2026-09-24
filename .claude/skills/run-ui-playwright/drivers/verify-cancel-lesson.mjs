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
//   • once that cancel has PASSED (aged two weeks back by psql — a cancel can
//     only be made in advance), tapping its DONE card on Schedule opens the
//     "This lesson was cancelled" notice naming the class, with "Back to class"
//     — not the permanent spinner it used to be (BACKLOG, fixed 2026-09-24);
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
import { launch, loginAdmin, loginExpo, gotoAuthed, tap, dumpText, visibleText, pressByText, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (l, p, d = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
};
const sql = (q) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -Atc "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();

// Errors ignored, each with its reason — the same exact entry as
// verify-smoke-app.mjs. NativeWind 4 throws it on every web load (its own
// dark-mode probe); matched as a substring, as there — a different throw still fails.
const IGNORED_ERRORS = ["Cannot manually set color scheme, as dark mode is type 'media'"];

// Press a visible leaf matching `pattern` that comes AFTER the Schedule's
// "DONE" heading in document order. Returns how many matched there; presses
// only when exactly one matched, or the first of them with { first: true }.
// Never a bare .last(): the count is the safety property (§7.101, §7.100).
async function pressAfterDone(pg, pattern, { first = false } = {}) {
  const n = await pg.evaluate(({ source, first }) => {
    const re = new RegExp(source);
    const leaves = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0);
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const done = leaves.find((e) => e.textContent.trim() === "DONE" && vis(e));
    if (!done) return 0;
    const hits = leaves.filter((e) =>
      vis(e) && re.test(e.textContent.trim()) &&
      (done.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (hits.length === 1 || (first && hits.length > 1)) {
      const t = hits[0].parentElement;
      const o = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
      t.dispatchEvent(new PointerEvent("pointerdown", o));
      t.dispatchEvent(new PointerEvent("pointerup", o));
      t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    return hits.length;
  }, { source: pattern.source, first });
  console.log(`pressed after DONE: ${pattern} (${n} match${n === 1 ? "" : "es"})`);
  return n;
}

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
  // The coach app renders month labels from the BROWSER's CLDR data, which for
  // September is "Sept" (4 letters); Node's en-US short month here is "Sep" (3).
  // An anchored `Sep$` silently stopped matching, so headerCount fell to 0, the
  // expand was skipped and the card never entered the DOM — two checks red for
  // the price of one string. This drove the driver red 2026-08-24..27, the first
  // nightlies whose today+7 crossed into September (a calendar coincidence with
  // the location deploy the same day, NOT its cause). Match the weekday and month
  // as PREFIXES so "Sep"/"Sept" (and "Thu"/"Thursday") both agree. §7.122 family.
  const dayHeader = new RegExp(`^${sgOpts({ weekday: "short" })}\\w*,? ${sgOpts({ day: "numeric" })} ${sgOpts({ month: "short" })}\\w*$`);
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

  // ── 5b. The cancelled lesson, once it has PASSED: DONE card → the notice ──
  // BACKLOG "A coach opening an admin-CANCELLED lesson gets a permanent spinner":
  // load()'s cancelled branch set `blocked` but never `resolved`, so the screen
  // spun forever; and the notice read the stale `classTitle` state ("cancelled
  // this lesson"). A cancel can only be made in ADVANCE (cancel_lesson refuses
  // p_date <= today), so the row the admin just cancelled through the UI is AGED
  // into the past by psql — as postgres, which guard_session_date exempts —
  // to the Rose weekday two weeks back (the fixture's own Rose rows are -7 and
  // -140, so -14 is free; asserted). It is moved back before step 6's Restore.
  // Reached by TAP (Schedule → week-prev ×2 → DONE → the card), not deep link:
  // a full-page load of the attendance URL leaves it mounted HIDDEN (§7.254).
  const twoWeeksAgo = shift(today, -14);
  const freeSlot = sql(`SELECT count(*) FROM lesson_sessions WHERE class_id='${ROSE}' AND session_date='${twoWeeksAgo}'`) === "0";
  check(`DB: no Rose session exists on ${twoWeeksAgo} (the aged cancel's landing slot)`, freeSlot);
  if (freeSlot) {
    sql(`UPDATE lesson_sessions SET session_date='${twoWeeksAgo}' WHERE class_id='${ROSE}' AND session_date='${nextWeek}'`);
    check("DB: the admin's cancel now sits two weeks back, still cancelled with its reason",
      sql(`SELECT status::text || ':' || coalesce(cancellation_reason,'') FROM lesson_sessions WHERE class_id='${ROSE}' AND session_date='${twoWeeksAgo}'`) === `cancelled:${REASON}`);

    const sctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const spin = await sctx.newPage();
    const spinErrors = [];
    spin.on("pageerror", (e) => spinErrors.push(e.message));
    spin.on("dialog", (d) => d.accept().catch(() => {}));
    await loginExpo(spin, "coach@swimsync.test", "password123");
    await gotoAuthed(spin, `${EXPO}/schedule`);
    await spin.waitForTimeout(2500);
    await tap(spin.getByTestId("week-prev"), "week-prev");
    await spin.waitForTimeout(2000);
    await tap(spin.getByTestId("week-prev"), "week-prev (2 weeks back)");
    await spin.waitForTimeout(2500);

    // Same day-header matching as step 5, and for the same reasons (§7.101, §7.122).
    const sg2 = (o) => new Date(`${twoWeeksAgo}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Singapore", ...o });
    const doneHeader = new RegExp(`^${sg2({ weekday: "short" })}\\w*,? ${sg2({ day: "numeric" })} ${sg2({ month: "short" })}\\w*$`);
    // ⚠ SCOPED TO DONE. NEEDS MARKING sits ABOVE it and its cards carry the same
    // "Thu, 10 Sept" subtitle (and a "Cal Rose Full" title — today's lesson, on a
    // fresh seed). Unscoped, the header press found 2 and skipped, and the card
    // press opened TODAY's ordinary lesson (run 2026-09-24).
    const doneHits = await pressAfterDone(spin, doneHeader);
    const expanded = doneHits === 1;
    check(`coach app: two weeks back, DONE lists the cancelled lesson's day (${doneHeader})`, expanded,
      `matched ${doneHits} under DONE`);
    await spin.waitForTimeout(1500);
    const doneText = await visibleText(spin);
    check("coach app: the DONE card is struck 'Cancelled by your admin'",
      /Cal Rose Full/.test(doneText) && /Cancelled by your admin/.test(doneText),
      doneText.match(/.{0,40}Cancelled by your admin/)?.[0] ?? "(not listed)");

    // The tap under test. Before the fix this is where the spinner held forever.
    const opened = (await pressAfterDone(spin, /^Cal Rose Full$/, { first: true })) >= 1;
    check("coach app: tapped the cancelled Rose card", opened);
    const notice = spin.getByText("This lesson was cancelled", { exact: true });
    let noticeShown = true;
    try {
      await notice.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      noticeShown = false;
    }
    await spin.screenshot({ path: shot("cancel-lesson-coach-notice.png"), fullPage: true });
    const nt = await visibleText(spin);
    check("coach app: the marking screen shows 'This lesson was cancelled' (no permanent spinner)", noticeShown,
      nt.slice(0, 160).replace(/\n/g, " | "));
    // cls.title, not the stale classTitle state: a cold open used to read "cancelled this lesson".
    check("coach app: the notice names the class and carries the admin's reason",
      /cancelled Cal Rose Full on /.test(nt) && nt.includes(REASON) && !/cancelled this lesson on/.test(nt),
      nt.match(/Your business's admin cancelled.{0,120}/)?.[0] ?? "(no notice detail)");
    check("coach app: a 'Back to class' control is offered",
      (await spin.getByText("Back to class", { exact: true }).count()) >= 1 && /Back to class/.test(nt));
    check("coach app: no roster or Save is rendered for a cancelled lesson", !/Save Attendance/i.test(nt));

    // And it is a way OUT: from=schedule, so Back to class returns to Schedule.
    const backed = await pressByText(spin, "Back to class");
    await spin.waitForTimeout(2500);
    const after = await visibleText(spin);
    check("coach app: 'Back to class' leaves the notice for Schedule",
      backed && !/This lesson was cancelled/.test(after) && /DONE/.test(after),
      spin.url());
    const realErrors = spinErrors.filter((m) => !IGNORED_ERRORS.some((s) => m.includes(s)));
    check("no uncaught page errors (coach, cancelled lesson)", realErrors.length === 0, realErrors.join(" || "));
    await sctx.close();

    // Put it back where step 6 (Restore) and the cleanup expect it.
    sql(`UPDATE lesson_sessions SET session_date='${nextWeek}' WHERE class_id='${ROSE}' AND session_date='${twoWeeksAgo}' AND cancellation_reason='${REASON}'`);
    check("DB: the aged cancel is back on next week", rowState() === `cancelled:true:${REASON}`, rowState());
  }

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
    // Step 5b ages the cancel two weeks back; if it died before moving it home,
    // bring it back first so the deletes below catch it.
    const twoBack = shift(today, -14);
    sql(`UPDATE lesson_sessions SET session_date='${nextWeek}' WHERE class_id='${ROSE}' AND session_date='${twoBack}' AND cancellation_reason='${REASON}' AND NOT EXISTS (SELECT 1 FROM lesson_sessions x WHERE x.class_id='${ROSE}' AND x.session_date='${nextWeek}')`);
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
