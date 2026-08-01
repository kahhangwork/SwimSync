// The attendance window as a RULE, and the roster as it was ON THE DAY.
//
// Guards four things no unit test can reach, because all four are what the
// coach's browser actually does with a URL:
//
//  1. THE ROSTER FOR A PAST LESSON IS THE ROSTER AS IT WAS THEN. A child who
//     joined last week must not appear on a lesson from three weeks ago. This
//     is the one the user spotted: because the save refuses until every student
//     on screen has a status, showing them FORCED the coach to record
//     attendance for a child who was not there — and, once the window guard
//     existed, the database would then refuse the save, so the coach could not
//     correct that lesson at all.
//  2. AN OUT-OF-WINDOW DATE IS REFUSED, in English, before a roster is offered.
//  3. SO IS A DAY THE CLASS DOES NOT RUN — the phantom lesson that could be
//     created and billed by typing a URL.
//  4. AN ADMIN-SCHEDULED EXTRA LESSON REACHES THE COACH. It is not derivable
//     from the class's weekday, so nothing else would surface it — while the
//     billing engine DOES block the month on it (core.ts datesToCheck unions
//     existing session dates). Invisible-but-blocking is the §7.18 shape.
//
// Setup (from repo root):
//   supabase db reset && docker restart supabase_db_SwimSync   # §7.44
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-attendance-guard.sql
//   cd SwimSyncApp && npx expo start --web    # :8081
//   cd SwimSyncAdmin && npm run dev           # :3000
//   node .claude/skills/run-ui-playwright/drivers/verify-attendance-guard.mjs
//
// The fixture PRINTS the dates it derived; this driver re-derives them from the
// database rather than from its own clock, so the two cannot disagree at a
// month boundary.
//
// GOTCHA (#6): the previous stack screen stays mounted under the current one,
// so assert on strings unique to the target screen.
import os from "node:os";
import { execSync } from "node:child_process";
import { launch, loginExpo, loginAdmin, tap, dumpText, gotoAuthed, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Press an RN-web Pressable by its label, by DISPATCHING events on the element
 * rather than clicking its coordinates.
 *
 * WHY force-click is not enough here, and this is gotcha #6 with teeth. The
 * screen you navigated away from stays mounted underneath — normally that only
 * pollutes document.body.innerText. When the target is reached by DEEP LINK the
 * stale screen is also laid out on top, so `document.elementFromPoint()` at the
 * button's own centre returns a card belonging to the OTHER screen. Playwright's
 * `click({force:true})` skips the actionability check but still clicks at those
 * coordinates, so the press silently lands on the overlay: the status never
 * changes, nothing errors, and the run reads as "the save is broken".
 *
 * Verified rather than assumed — the diagnostic printed
 * `isSelfOrChild: false` with a Today-screen card on top.
 */
async function pressByText(page, label, index = 0) {
  const ok = await page.evaluate(
    ({ label, index }) => {
      const hits = [...document.querySelectorAll("*")].filter(
        (e) => e.children.length === 0 && e.textContent.trim() === label
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

/** Ask the database for the fixture's anchor dates. One source of truth. */
function sql(q) {
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc ${JSON.stringify(q)}`,
    { encoding: "utf8" }
  ).trim();
}

const CLASS_ID = sql("SELECT id FROM classes WHERE title='Saturday Beginners'");
// The two classes folded in from the retired verify-attendance-window.mjs
// (2026-08-01). NEW_CLASS's first lesson is still ahead; its sibling
// 'Guard Waiting' has already had one and was never marked. The id is literal
// because the fixture creates it literally — no lookup a second class confuses.
const NEW_CLASS_ID = "d0000000-0000-0000-0000-0000000000e1";
const NEW_CLASS_DOW = sql(`SELECT day_of_week::text FROM classes WHERE id='${NEW_CLASS_ID}'`);
const TODAY = sql("SELECT (now() AT TIME ZONE 'Asia/Singapore')::date");
const LAST_SAT = sql(
  "SELECT ((now() AT TIME ZONE 'Asia/Singapore')::date - ((EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int + 1) % 7))"
);
const D_PAST = sql(`SELECT '${LAST_SAT}'::date - 21`);
const D_CLOSED = sql(`SELECT '${LAST_SAT}'::date - 140`);
const D_WRONGDAY = sql(
  `SELECT CASE WHEN EXTRACT(DOW FROM '${TODAY}'::date - 2) = 6 THEN '${TODAY}'::date - 3 ELSE '${TODAY}'::date - 2 END`
);
const D_EXTRA = sql(
  `SELECT CASE WHEN EXTRACT(DOW FROM '${TODAY}'::date + 3) = 6 THEN '${TODAY}'::date + 4 ELSE '${TODAY}'::date + 3 END`
);

console.log({ CLASS_ID, TODAY, LAST_SAT, D_PAST, D_CLOSED, D_WRONGDAY, D_EXTRA });

const mobile = {
  viewport: { width: 420, height: 900 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "Asia/Singapore",
};
const { browser } = await launch();

try {
  // ══════════════ ADMIN: schedule an extra lesson ══════════════
  // Done first so the coach app below can see it. The admin panel has no
  // attendance writing at all — it ARRANGES the lesson, the coach OBSERVES it.
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const apage = await actx.newPage();
  // The seed coach is also their tenant's admin — a private coach is a tenant
  // of one (§6). The platform admin is refused the single-business pages.
  await loginAdmin(apage, "coach@swimsync.test", "password123");
  await apage.goto(`${ADMIN}/classes`, { waitUntil: "networkidle" });
  await apage.waitForTimeout(1500);

  // SCOPED TO THE CLASS'S OWN ROW. This was `getByText("Extra lesson").first()`,
  // which schedules against whichever class the table happens to list first —
  // correct only while the fixture had exactly one class. Adding 'Guard Newbies'
  // (2026-08-01) made it target the wrong class, and three checks below went red
  // while the "admin can schedule" check kept PASSING, because it only asserted
  // that *a* confirmation appeared. Same family as §7.73: never index into a
  // list whose length you do not control.
  const extraRow = apage.locator("tr", { hasText: "Saturday Beginners" });
  await tap(extraRow.getByText("Extra lesson"), "Extra lesson button (Saturday Beginners row)");
  await apage.waitForTimeout(800);

  // The modal titles itself `Extra lesson — <class>`, so this is the cheap
  // structural proof that the row scoping worked. Without it the checks below
  // can only say "something was scheduled", not "the right class was".
  const modalTitle = await dumpText(apage, 200);
  check("the extra-lesson dialog is for the class under test, not another one",
    /Extra lesson — Saturday Beginners/.test(modalTitle),
    modalTitle.match(/Extra lesson[^\n]*/)?.[0] ?? "(no title)");

  await apage.locator('input[type="date"]').fill(D_EXTRA);
  await apage
    .locator('input[placeholder*="Makeup"]')
    .fill("Makeup for the public holiday");
  await tap(apage.getByText("Schedule lesson").last(), "Schedule lesson");
  await apage.waitForTimeout(2500);

  let at = await dumpText(apage, 400);
  await apage.screenshot({ path: `${SHOT}/ag-admin-extra.png`, fullPage: true });
  check("admin can schedule an extra lesson off the class's weekday",
    /Scheduled for/.test(at), at.match(/Scheduled for[^\n.]*/)?.[0] ?? "(no confirmation)");

  const storedReason = sql(
    `SELECT COALESCE(off_schedule_reason,'(null)') FROM lesson_sessions WHERE class_id='${CLASS_ID}' AND session_date='${D_EXTRA}'`
  );
  check("the reason is recorded on the session",
    storedReason === "Makeup for the public holiday", storedReason);

  // A second identical press must not create a second row: a duplicate
  // (class, date) double-bills the whole class (§7.7).
  // Re-open from the same scoped row — the modal closes on success.
  if (!(await apage.locator('input[type="date"]').count())) {
    await tap(extraRow.getByText("Extra lesson"), "Extra lesson button (re-open)");
    await apage.waitForTimeout(800);
  }
  await apage.locator('input[type="date"]').fill(D_EXTRA);
  await apage
    .locator('input[placeholder*="Makeup"]')
    .fill("Makeup for the public holiday");
  await tap(apage.getByText("Schedule lesson").last(), "Schedule lesson (again)");
  await apage.waitForTimeout(2000);
  const extraCount = sql(
    `SELECT count(*) FROM lesson_sessions WHERE class_id='${CLASS_ID}' AND session_date='${D_EXTRA}'`
  );
  check("scheduling it twice leaves exactly ONE session", extraCount === "1", `count=${extraCount}`);

  // ══════════════ COACH ══════════════
  const cctx = await browser.newContext(mobile);
  const page = await cctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await loginExpo(page, "coach@swimsync.test", "password123");

  // ── 1. The roster for a past lesson ──────────────────────────────────────
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS_ID}/attendance?date=${D_PAST}`);
  await page.waitForTimeout(3000);
  let t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ag-coach-past.png`, fullPage: true });

  check("a past in-window lesson still opens for marking",
    /Ana Guard/.test(t), t.includes("Ana Guard") ? "Ana present" : "(Ana missing)");
  check("a child who joined LATER is not on that lesson's roster",
    !/Late Joiner/.test(t),
    /Late Joiner/.test(t) ? "Late Joiner wrongly shown" : "correctly absent");

  // ── 2. Out of window ─────────────────────────────────────────────────────
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS_ID}/attendance?date=${D_CLOSED}`);
  await page.waitForTimeout(3000);
  t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ag-coach-closed.png`, fullPage: true });
  check("an out-of-window date is refused with an explanation",
    /That lesson is closed/.test(t), t.match(/That lesson is closed/)?.[0] ?? "(no message)");
  check("…and no markable roster is offered",
    !/Save Attendance/.test(t) && !/Set all/.test(t));

  // ── 3. A day the class does not run ──────────────────────────────────────
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS_ID}/attendance?date=${D_WRONGDAY}`);
  await page.waitForTimeout(3000);
  t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ag-coach-wrongday.png`, fullPage: true });
  check("a non-lesson day is refused — the phantom lesson a URL could bill",
    /That isn't a lesson day/.test(t) || /That isn’t a lesson day/.test(t),
    t.match(/That isn.t a lesson day/)?.[0] ?? "(no message)");
  check("…and it points at the remedy rather than dead-ending",
    /extra lesson/.test(t));

  // ── 4. The admin's extra lesson reaches the coach ────────────────────────
  // Straight to the roster rather than via the tab bar: the blocked screen
  // above renders its own header, and the tab links are not reliably resolvable
  // from it.
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS_ID}/roster`);
  await page.waitForTimeout(3500);
  t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ag-coach-roster.png`, fullPage: true });
  check("the coach is told an extra lesson is coming",
    /Extra lesson.? coming up/.test(t), t.match(/Extra lesson.{0,20}/)?.[0] ?? "(absent)");
  check("…with the admin's reason, so it is not a mystery",
    /Makeup for the public holiday/.test(t));

  // ── 5. THE SAVE PATH, WHICH IS WHERE THE UPSERT LIVES ────────────────────
  // The coach's save is .upsert(..., { onConflict }), which PostgREST emits as
  // INSERT … ON CONFLICT DO UPDATE — and Postgres fires BEFORE INSERT triggers
  // for rows that resolve to an UPDATE. A guard written naively as "INSERT
  // only" therefore refuses every correction, and because the save sends every
  // student in ONE statement, one refused row fails the whole class's save.
  // pgTAP pins this at the SQL level; this is the same path through the real
  // screen, which is the one production actually walks.
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS_ID}/attendance?date=${D_PAST}`);
  await page.waitForTimeout(3000);
  await pressByText(page, "Present");
  await page.waitForTimeout(700);
  await pressByText(page, "Save Attendance");
  await page.waitForTimeout(3500);

  // One line: the query is passed through `docker exec ... -c`, and an embedded
  // newline arrives as a literal \n rather than whitespace.
  const markedStatus = () => sql(
    `SELECT COALESCE(a.status::text,'(none)') FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id WHERE ls.class_id='${CLASS_ID}' AND ls.session_date='${D_PAST}'`
  );
  let saved = markedStatus();
  check("a first save on an in-window lesson persists", saved === "present", saved);

  // Now the CORRECTION — the second save over the same row, which is the
  // upsert-that-is-really-an-update.
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS_ID}/attendance?date=${D_PAST}`);
  await page.waitForTimeout(3000);
  await pressByText(page, "Absent");
  await page.waitForTimeout(700);
  await pressByText(page, "Save Attendance");
  await page.waitForTimeout(3500);

  saved = markedStatus();
  check("a correction to that lesson saves — the upsert is not refused as an insert",
    saved === "absent", saved);

  // The future extra lesson must NOT be markable yet.
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS_ID}/attendance?date=${D_EXTRA}`);
  await page.waitForTimeout(3000);
  t = await dumpText(page);
  check("a future extra lesson cannot be marked ahead of time",
    /hasn't happened yet/.test(t) || /hasn’t happened yet/.test(t),
    t.match(/That lesson.{0,25}/)?.[0] ?? "(no message)");

  // ══════════ 6. THE EMPTY STATES, folded in from verify-attendance-window.mjs
  // That driver was deleted 2026-08-01: its fixture hard-coded 2026-07-16 and
  // needed "no Sunday since", true for three days in July 2026, so it rotted to
  // 2/5 with the PRODUCT correct in every case. The three checks below are the
  // half of it nothing else guarded, rebuilt on this fixture's anchor.

  // Risk-3 assertion: 'Guard Newbies' must not share a weekday with
  // 'Saturday Beginners'. If it did, a Saturday could already have fallen due
  // and "nothing has happened yet" would be false — silently, and only on
  // Fridays. Fail loudly instead.
  // The emptiness test is deliberate: an unloaded fixture makes sql() return "",
  // and `"" !== "saturday"` would pass this check while proving nothing.
  check("the not-yet-started class does not collide with the Saturday class",
    NEW_CLASS_DOW.length > 0 && NEW_CLASS_DOW !== "saturday",
    `day_of_week=${NEW_CLASS_DOW || "(class not found — is the fixture loaded?)"}`);

  await gotoAuthed(page, `${EXPO}/(coach)/classes/${NEW_CLASS_ID}/roster`);
  await page.waitForTimeout(3500);
  t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/ag-coach-notyet.png`, fullPage: true });
  check("coach roster offers a placeholder, not a button, before the first lesson",
    /No lessons to mark yet/.test(t) && /first lesson hasn't taken place yet/.test(t),
    t.match(/No lessons to mark yet/)?.[0] ?? "(no placeholder)");

  // ── The parent's two empty states, which are DIFFERENT SENTENCES ─────────
  // "No lessons marked yet"          → a lesson happened, the coach is behind
  // "No lessons have taken place yet" → nothing has happened; nobody is behind
  // Telling a family the second thing in the first words accuses their coach of
  // being late when they are not (PRD §5.1). Each check therefore asserts the
  // expected sentence is present AND THE SIBLING IS ABSENT: a prior screen stays
  // mounted under the current one (§7.10, §7.58), so a present-only assertion
  // can pass on the other child's panel and prove nothing.
  const pctx = await browser.newContext(mobile);
  const ppage = await pctx.newPage();
  ppage.on("dialog", (d) => d.accept().catch(() => {}));
  await loginExpo(ppage, "parent-guard@swimsync.test", "password123");
  await tap(ppage.locator('a[href="/attendance"]').first(), "Attendance tab");
  await ppage.waitForTimeout(3500);

  // Neither empty state names the child (the copy is just the sentence plus
  // "Lessons appear here once the coach marks attendance"), so there is no name
  // to assert on. The available proof that the tap actually MOVED the selection
  // is that the two panels differ: 'Late Joiner' is also unmarked with lessons
  // due, so a chip tap that silently did nothing could otherwise satisfy the
  // first check on the wrong child's panel.
  const panels = [];
  for (const [chip, expected, sibling] of [
    ["Waiting",   "No lessons marked yet",           "No lessons have taken place yet"],
    ["Newjoiner", "No lessons have taken place yet", "No lessons marked yet"],
  ]) {
    await tap(ppage.getByText(chip, { exact: true }).last(), `${chip} chip`);
    await ppage.waitForTimeout(3000);
    const pt = await dumpText(ppage);
    panels.push(pt);
    await ppage.screenshot({ path: `${SHOT}/ag-parent-${chip.toLowerCase()}.png`, fullPage: true });
    check(`parent: ${chip} reads "${expected}" and NOT its sibling state`,
      pt.includes(expected) && !pt.includes(sibling),
      pt.includes(expected)
        ? (pt.includes(sibling) ? "BOTH sentences on screen — wrong child selected?" : "ok")
        : "expected sentence absent");
  }
  check("selecting the second child actually changed the panel",
    panels.length === 2 && panels[0] !== panels[1],
    panels[0] === panels[1] ? "identical panels — the chip tap did nothing" : "ok");
} catch (err) {
  // Without this the process.exit() below swallows the stack trace, and a run
  // that died half way through prints a tidy "9/9 passed" — which reads as a
  // clean pass rather than a truncated run.
  console.error("\nDRIVER ABORTED:", err?.message ?? err);
  results.push(false);
} finally {
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log(`screenshots: ${SHOT}`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
