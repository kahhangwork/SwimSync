// verify-coach-roster.mjs — Wave 3's lesson-level coach roster, end to end.
//
// WHAT THIS OWNS. Wave 3 (20260811000200) shipped with 40 pgTAP checks, 40
// vitest, 40 jest and a manual UI walk — and NOTHING in the nightly sweep. It
// was the one shipped surface that would rot silently, which matters more here
// than elsewhere because its failure mode is a guest the substitute cannot see,
// an incompletely marked lesson, and a billing month that will not close with
// no override (§8i) and nothing on any screen saying why. No unit test can
// reach that: it needs the real RLS path, in a browser, as a coach who is not
// the tenant admin.
//
// ⚠ THE SUBSTITUTE AND THE SHADOW ARE NON-ADMIN COACHES, AND THAT IS THE POINT
// (§7.131). `coach@swimsync.test` is deliberately also the tenant admin, so
// every `coach_branch OR can_admin_tenant(...)` policy answers through the admin
// branch on that account and no narrowing can be observed at all.
//
// ⚠ NOT RE-RUNNABLE BY HAND. Check 14 MARKS the fixture lesson, and check 0's
// positive control requires it unmarked; the roster assignments are idempotent
// but the attendance is not. Apply the teardown and the fixture again between
// runs. The nightly sweep resets per driver, so this only bites a hand-run.
// (The fixture is a no-op on re-apply only WITHIN one SGT weekday: `classes …
// ON CONFLICT (id) DO NOTHING` keeps the stale `day_of_week`, and its own
// postcondition block then aborts the apply. Loud, and the teardown fixes it.)
//
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-coach-roster-teardown.sql
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-coach-roster.sql
//
// MEASURED SABOTAGE SIGNATURE — a check that cannot go red is a check that is
// testing nothing, and Wave 2 shipped one of those (matched zero times, passed
// anyway). Every row below was RUN, and two of them found this driver claiming
// coverage it did not have:
//
//   | Sabotage                                           | Score | Red |
//   |----------------------------------------------------|-------|-----|
//   | Revert assign_session_coach's guard (the DOWN file) | abort | 6b  |
//   | Delete ONLY the absence branch, keep the row guard  | 24/25 | 6c  |
//   | coveredOutFrom -> new Set(asked): hide EVERYTHING   | 24/25 | 17  |
//   | DROP sessions_i_am_main_on (404 -> empty set)       | 24/25 | 16  |
//
// Row 1 aborts rather than merely failing: without the guard the demote really
// happens, the lesson is left with no main, and the Clear button the next step
// presses no longer exists. Loud, and in the right place.
//
// TWO THINGS THIS TABLE BOUGHT, both of which were green-over-broken first:
//
//   · Row 3 scored a full 25/25 until the fixture gave CLASS B's lesson a
//     lesson_sessions row. The Schedule tab only probes a backlog lesson that
//     already has one, so with neither lesson probed, "hide everything" changed
//     nothing on screen and check 17 was decorative.
//   · Row 4 scored 25/25 until the replaced-coach checks were moved BEFORE the
//     substitute marks the lesson. A fully marked lesson leaves the backlog
//     whatever its roster says, so check 16 was passing for a reason that had
//     nothing to do with §7.134.
//
// If you reorder this driver, re-measure rows 3 and 4. They are the two that
// depend on the order rather than on the assertions.
//
// Setup:
//   Admin on :3000, Expo web on :8081, and the fixture applied.
//     docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//       < drivers/fixtures-coach-roster.sql
//     node drivers/verify-coach-roster.mjs

import { execSync } from "node:child_process";
import {
  launch, loginAdmin, loginExpo, pressByText, gotoAuthed, ADMIN, EXPO, visibleText,
} from "./lib.mjs";

const CLASS_A = "c7000000-0000-0000-0000-00000000000a";
const CLASS_A_TITLE = "RosterCov Lane";
const CLASS_B_TITLE = "RosterCov Second";
const SUB_EMAIL = "roster-sub@swimsync.test";
const SHADOW_EMAIL = "roster-shadow@swimsync.test";
const SEED_EMAIL = "coach@swimsync.test";
const SUB_NAME = "RosterCov Sub";
const SHADOW_NAME = "RosterCov Shadow";
const KID = "RosterCov Kid";
const GUEST = "RosterCov Guest";

let pass = 0;
let fail = 0;

function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function sql(q) {
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc ${JSON.stringify(
      q.replace(/\n/g, " ")
    )}`,
    { encoding: "utf8" }
  ).trim();
}

// The lesson under test: the same weekday LAST WEEK, matching the fixture. It
// has no lesson_sessions row until somebody creates one — assign_session_coach()
// resolves-or-creates, and the coach's first save would too — so it is COMPUTED,
// never read back from a table that may legitimately be empty.
const PATTERN_DATE = sql(
  `SELECT ((now() AT TIME ZONE 'Asia/Singapore')::date - 7)::text`
);
const MONTH = PATTERN_DATE.slice(0, 7);
// "Tue, 11 Aug" — how formatSgDate renders a lesson date in the admin table
// (en-SG, weekday short / day numeric / month short). Derived from the same
// date, so a formatting change breaks it loudly rather than silently matching
// nothing (§7.101: a check that matches zero times passes while testing nothing).
const LESSON_LABEL = sql(
  `SELECT to_char(DATE '${PATTERN_DATE}', 'Dy, FMDD Mon')`
);

(async () => {
  // ── The fixture is real. Runs first and hard-exits: every assertion below
  // ── is an existence claim about these rows, or an absence claim that is
  // ── vacuous without them.
  const coaches = Number(
    sql(
      `SELECT count(*) FROM coaches WHERE profile_id::text LIKE 'c7000000-%'`
    )
  );
  if (coaches !== 2) {
    console.log(`FIXTURE MISSING: expected 2 roster coaches, found ${coaches}.`);
    console.log("Apply drivers/fixtures-coach-roster.sql first.");
    process.exit(1);
  }
  console.log(`fixture lesson: ${PATTERN_DATE} (${LESSON_LABEL}), month ${MONTH}`);

  // ⚠ DESKTOP VIEWPORT, NOT `mobile: true`, AND IT IS LOAD-BEARING. Every driver
  // in this repo that MARKS attendance uses the default 1280×900
  // (verify-bulk-setall.mjs, verify-unmarked-lessons.mjs). On the 420-wide
  // mobile viewport the status buttons render but a press on them does nothing —
  // measured here: "Not yet marked" stayed at 2 after both a normal and a forced
  // click, and check 14 failed while checks 12 and 13 passed on the same screen.
  // A screen that renders is not a screen that can be operated.
  const { browser, ctx, page } = await launch();

  /** Log in as a DIFFERENT coach. loginExpo short-circuits when the page is
   *  already on the app and off /login — correct for its own retry loop, and
   *  wrong for a driver that changes persona: it would keep the previous
   *  session and assert one coach's screen while claiming another's. This
   *  driver switches THREE times. Same shape as verify-paynow-fallback.mjs. */
  async function freshLogin(email) {
    await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.clear());
    await loginExpo(page, email);
    await page.waitForTimeout(2500);
  }

  /** WHO AM I, asserted on screen before anything is claimed about a lesson.
   *  §7.134's entire subject is WHICH coach can see a row, so a driver that
   *  cannot prove who it is logged in as cannot prove anything at all. */
  async function assertIdentity(email, label) {
    await page.goto(`${EXPO}/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    // document.body.innerText, not visibleText(): a previous screen stays
    // mounted on RN-web (§7.58) and visibleText's filtering drops the Settings
    // rows underneath it, so the identity check would fail while the email is
    // plainly on the page.
    const t = await page.evaluate(() => document.body.innerText);
    check(`${label} — signed in as ${email}`, t.includes(email),
      t.match(/[\w.-]+@swimsync\.test/)?.[0] ?? "no email on screen");
  }

  async function schedule() {
    await page.goto(`${EXPO}/schedule`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);
    return visibleText(page);
  }

  // ═══ 0. POSITIVE CONTROL — the lesson IS the seed coach's to mark ════════
  // Without this, check 16 ("it is no longer listed") is indistinguishable from
  // a driver that logged in as the wrong user, or a Schedule tab that failed to
  // load, or a fixture whose lesson had not ended yet. The PAIR is the
  // assertion, not either half.
  await freshLogin(SEED_EMAIL);
  await assertIdentity(SEED_EMAIL, "0a");
  let text = await schedule();
  // Scoped to the text AFTER the heading, exactly as check 16 is. A bare
  // `text.includes(title)` would also match the class's own WEEK CARD, which is
  // on screen whether or not anybody has to mark it — the two checks would then
  // be asserting different things while looking symmetrical.
  // ⚠ BOUNDED AT BOTH ENDS. `split("NEEDS MARKING")[1]` alone runs to the end of
  // the page, which swallows the TODAY section and every week card — and the
  // covered class has a week card whatever its roster says. Check 16 then fails
  // for a reason that has nothing to do with §7.134, which is exactly what it
  // did before this bound was added. "TODAY ·" is the next heading.
  const backlog = (t) => (t.split(/NEEDS MARKING/)[1] ?? "").split(/TODAY ·/)[0];
  check(
    "0 — the fixture lesson starts on the class coach's NEEDS MARKING list",
    backlog(text).includes(CLASS_A_TITLE),
    `NEEDS MARKING present: ${/NEEDS MARKING/.test(text)}`
  );

  // ═══ A. THE ADMIN ASSIGNS ═══════════════════════════════════════════════
  const admin = await ctx.browser().newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await admin.newPage();
  await loginAdmin(ap, SEED_EMAIL);
  await ap.goto(`${ADMIN}/lesson-coaches`, { waitUntil: "domcontentloaded" });
  await ap.waitForTimeout(2500);

  async function openRoster(p = ap) {
    await p.selectOption("select", { index: 0 }).catch(() => {});
    await p.locator("select").first().selectOption(CLASS_A);
    await p.locator('input[type="month"]').fill(MONTH);
    await p.waitForTimeout(2500);
  }
  await openRoster();

  let atext = await ap.locator("body").innerText();
  check("1 — the class's lessons for the month are listed", atext.includes(LESSON_LABEL), LESSON_LABEL);
  check(
    "2 — an untouched lesson names the class's own coach (the absence rule, visible)",
    // Scoped to THIS lesson's row. Page-wide, `/class coach/` is true whenever
    // the page renders at all at this point, since no lesson has a roster row
    // yet — it would pass without ever looking at the lesson under test.
    /class coach/.test(await row(LESSON_LABEL).first().innerText()),
    "the 'class coach' hint is what says NO roster row exists"
  );

  /** The Actions cell of one lesson row. Addressed by the row's DATE — never by
   *  an ordinal over a list this driver does not own (§7.75, §7.101). */
  function row(label, p = ap) {
    return p.locator("tr").filter({ hasText: label });
  }

  async function assign(label, kind, coachName, p = ap) {
    await row(label, p)
      .getByRole("button", { name: kind === "main" ? /Assign a substitute|Change/ : /Add shadow/ })
      .first()
      .click();
    await p.waitForTimeout(800);
    const sel = row(label, p).locator("select");
    await sel.selectOption({ label: coachName });
    await row(label, p).getByRole("button", { name: "Save" }).click();
    await p.waitForTimeout(2500);
  }

  await assign(LESSON_LABEL, "main", SUB_NAME);
  atext = await ap.locator("body").innerText();
  check(
    "3 — assigning a substitute says the lesson MOVED onto their marking list",
    atext.includes(SUB_NAME) && /moved onto their marking list/.test(atext),
    atext.match(/RosterCov Sub is now teaching[^.]*\./)?.[0] ?? ""
  );
  check(
    "4 — and the row now names the substitute, badged as covering",
    /Covering for/.test(atext) && atext.includes(SUB_NAME),
    "the Covering-for badge distinguishes a cover from a pinned class coach"
  );

  await assign(LESSON_LABEL, "shadow", SHADOW_NAME);
  atext = await ap.locator("body").innerText();
  check(
    "5 — a shadow is added and shown in the Shadowing column",
    atext.includes(SHADOW_NAME) && /shadowing/i.test(atext),
    "one lesson, two coaches, two payout rows"
  );

  // ── 6. The dropdown does not offer the lesson's current main ─────────────
  // assignableShadows() removes it BY COACH ID, absence-rule main included, so
  // there is no click path in one tab that offers the main as a shadow. This is
  // the reachable half of the guard and what actually protects a real admin;
  // the server halves are 6b/6c below.
  await row(LESSON_LABEL).getByRole("button", { name: /Add shadow/ }).first().click();
  await ap.waitForTimeout(700);
  const options = await row(LESSON_LABEL).locator("select option").allInnerTexts();
  check(
    "6 — the shadow dropdown does NOT offer the lesson's current main",
    // ⚠ `options.length > 1` IS HALF THE CHECK. An absence over an EMPTY list is
    // true for free: if the Add-shadow click failed or the row resolved to
    // nothing, `options` is [] and the assertion passes having opened no
    // dropdown at all. The list must exist AND lack the main.
    options.length > 1 && !options.includes(SUB_NAME),
    `offered: ${options.filter((o) => /RosterCov|Marcus/.test(o)).join(", ") || "(nobody named)"}`
  );

  // ── 6b/6c. THE SERVER GUARD, reached the only way a real admin can reach it:
  // ── a tab whose `lessons` state is STALE (§7.133). The client pre-check
  // ── compares pickedCoach against a stale `lesson.main.coach_id`, so it fires
  // ── only when the stale value happens to be right — precisely when the
  // ── server guard is not needed.
  //
  // ⚠ BOTH STALE SELECTIONS ARE MADE NOW, WHILE THE SUBSTITUTE IS STILL MAIN.
  // assignableShadows() drops the effective main from the dropdown the moment it
  // changes, so a tab opened after the change cannot select the coach whose
  // demotion is under test at all — the race has to be set up before it, in two
  // tabs, exactly as two admins working at once would.
  //
  // ⚠ THE ASSERTION IS THE SERVER'S OWN SENTENCE, not "Could not assign".
  // Both guards render through the same line, so asserting the shared prefix is
  // a check that cannot tell which one fired.
  const seedCoachName = sql(
    `SELECT p.full_name FROM classes c JOIN coaches co ON co.id = c.coach_id
       JOIN profiles p ON p.id = co.profile_id WHERE c.id = '${CLASS_A}'`
  );

  async function armStaleShadowPick(coachName) {
    const t = await admin.newPage();
    await t.goto(`${ADMIN}/lesson-coaches`, { waitUntil: "domcontentloaded" });
    await t.waitForTimeout(2500);
    await openRoster(t);
    await row(LESSON_LABEL, t).getByRole("button", { name: /Add shadow/ }).first().click();
    await t.waitForTimeout(700);
    await row(LESSON_LABEL, t).locator("select").selectOption({ label: coachName });
    return t;
  }
  const staleRow = await armStaleShadowPick(seedCoachName);      // for 6b
  const staleAbsence = await armStaleShadowPick(seedCoachName);  // for 6c

  // 6b — the ROW main. The live tab makes the class's own coach the main by an
  // explicit assignment, so a real session_coaches row exists to be demoted.
  await ap.reload({ waitUntil: "domcontentloaded" });
  await ap.waitForTimeout(2000);
  await openRoster();
  await assign(LESSON_LABEL, "main", seedCoachName);

  await row(LESSON_LABEL, staleRow).getByRole("button", { name: "Save" }).click();
  await staleRow.waitForTimeout(2500);
  let stext = await staleRow.locator("body").innerText();
  check(
    "6b — the SERVER refuses shadowing the lesson's ROW main from a stale tab",
    /already the main coach for this lesson/.test(stext),
    stext.match(/Could not assign:[^\n]*/)?.[0] ?? "(no refusal on screen)"
  );
  await staleRow.close();

  // 7 — Clear removes that row, so the same coach is now main by the ABSENCE
  // rule instead: same person, no row.
  await ap.reload({ waitUntil: "domcontentloaded" });
  await ap.waitForTimeout(2000);
  await openRoster();
  await row(LESSON_LABEL).getByRole("button", { name: "Clear" }).first().click();
  await ap.waitForTimeout(2500);
  atext = await ap.locator("body").innerText();
  check(
    "7 — Clear returns the lesson to the class's own coach",
    /is back with/.test(atext) && /class coach/.test(atext),
    atext.match(/[^\n]*is back with[^\n]*/)?.[0] ?? ""
  );

  // 6c — the ABSENCE main. Nothing conflicts, so `ON CONFLICT ... WHERE role <>
  // 'main'` has nothing to see; only the branch added in 20260812000100 refuses
  // it. Without that branch this check is green WHILE THE ROW IS WRITTEN, which
  // is what makes the second tab worth its cost.
  await row(LESSON_LABEL, staleAbsence).getByRole("button", { name: "Save" }).click();
  await staleAbsence.waitForTimeout(2500);
  stext = await staleAbsence.locator("body").innerText();
  check(
    "6c — the SERVER refuses shadowing the ABSENCE-RULE main (no client path reaches this)",
    /already teaches this lesson as the class's coach/.test(stext),
    stext.match(/Could not assign:[^\n]*/)?.[0] ?? "(no refusal on screen)"
  );
  await staleAbsence.close();

  // ── 8. The off-pattern lesson the fixture inserted directly ─────────────
  const EXTRA_LABEL = sql(
    `SELECT to_char(ls.session_date, 'Dy, FMDD Mon') FROM lesson_sessions ls
      WHERE ls.id = 'c7000000-0000-0000-0000-0000000000d1'`
  );
  check(
    "8 — a lesson off the class's weekly pattern is badged Extra",
    atext.includes(EXTRA_LABEL) &&
      /Extra/.test(await row(EXTRA_LABEL).first().innerText().catch(() => "")),
    EXTRA_LABEL
  );

  // Put the substitute back on the lesson — part B is about THEIR screen.
  await assign(LESSON_LABEL, "main", SUB_NAME);
  await admin.close();

  // ═══ THE REPLACED COACH GOES QUIET — BEFORE ANYBODY MARKS ANYTHING ══════
  // ⚠ THE ORDER IS THE CHECK. Run after the substitute has marked the lesson,
  // check 16 passes because a FULLY MARKED lesson leaves the backlog whatever
  // its roster says — measured: with sessions_i_am_main_on dropped entirely the
  // driver still scored 25/25. The lesson must still be UNMARKED here, so that
  // the only thing that can have removed it is the covered-out answer.
  await freshLogin(SEED_EMAIL);
  await assertIdentity(SEED_EMAIL, "16a");
  text = await schedule();
  check(
    "16 — the covered lesson has LEFT the class coach's NEEDS MARKING list (§7.134)",
    !backlog(text).includes(CLASS_A_TITLE),
    "paired with check 0 — an absence assertion with no positive control proves nothing"
  );
  check(
    "17 — …and the REST of their week is untouched — 'hid everything' is not a pass",
    backlog(text).includes(CLASS_B_TITLE),
    CLASS_B_TITLE
  );

  // ═══ B. THE SUBSTITUTE TEACHES IT ═══════════════════════════════════════
  // Any ONE missing policy fails this section: no class row means no title and
  // no week card, no enrolment rows mean nobody to mark, and an invisible guest
  // means a billing month that will not close.
  await freshLogin(SUB_EMAIL);
  await assertIdentity(SUB_EMAIL, "9");
  text = await schedule();
  check("10 — the covered lesson appears on the substitute's week", text.includes(CLASS_A_TITLE));
  check(
    "11 — …with the class TITLE rendered, not a blank card",
    text.includes(CLASS_A_TITLE) && !/Unknown class/i.test(text),
    "five of Wave 3's nine policies were invisible from the feature description"
  );

  // innerText, not visibleText(): the schedule screen stays mounted underneath
  // on RN-web (§7.58) and visibleText's filtering drops the marking rows sitting
  // beneath it — measured, and it cost checks 12/13 a false FAIL. Every read
  // below is a PRESENCE assertion over this screen's own strings, which the
  // stacked screen cannot forge: no other screen names a student.
  const marking = () => page.evaluate(() => document.body.innerText);

  // ⚠ REACHED BY TAPPING THE BACKLOG ROW, NOT BY A DEEP LINK — and that is a
  // behavioural difference, not a stylistic one. A deep-linked marking screen
  // RENDERS correctly (the roster and the guest are both there) but does not
  // accept a press on a status button: measured, "Not yet marked" stayed at 2
  // after both a normal and a forced click. Every driver that marks attendance
  // in this repo navigates in-app (verify-bulk-setall.mjs), and it is also the
  // real journey — the coach taps the straggler on their Schedule tab.
  // ⚠ pressByText, NOT a Playwright click. RN-web's press handler lives on the
  // Pressable, and `getByText` resolves to the Text CHILD — a click there is
  // swallowed, silently. Measured on this driver: the taps logged, the screen
  // never changed, and zero attendance rows were written while checks 12 and 13
  // passed on the same screen. pressByText dispatches pointerdown/pointerup/click
  // on the parent, which is why every other marking driver uses it.
  await pressByText(page, "Mark");
  await page.waitForTimeout(9000);
  let mtext = await marking();
  check("12 — the enrolled child is on the substitute's roster", mtext.includes(KID));
  check(
    "13 — THE GUEST IS VISIBLE — an invisible one is a billing month that will not close",
    mtext.includes(GUEST) && /Trial/.test(mtext),
    "the engine expects the guest, the block has no override (§8i), no screen says why"
  );

  const unmarkedBefore = (mtext.match(/Not yet marked/g) ?? []).length;
  // ⚠ EVERY STUDENT, NOT ONE. handleSave() refuses the whole save with a toast
  // if ANY student is still unmarked — so marking only the enrolled child left
  // the trial guest blank and wrote ZERO rows, silently on RN-web where
  // Alert.alert is a no-op. It looked exactly like an RLS refusal of the
  // substitute, which is the thing this check exists to disprove. The guest is
  // the second row precisely because check 13 put them there.
  await pressByText(page, "Present", 0);
  await page.waitForTimeout(1200);
  await pressByText(page, "Present", 1);
  // The status has to land in React state before Save reads it.
  await page.waitForTimeout(2500);
  const stillUnmarked = ((await visibleText(page)).match(/Not yet marked/g) ?? []).length;
  check(
    "13b — both the enrolled child and the guest can be given a status",
    stillUnmarked === 0,
    `${stillUnmarked} still unmarked — a save with any blank row is refused outright`
  );
  await pressByText(page, "Save Attendance");
  await page.waitForTimeout(5000);
  const marks = Number(
    sql(
      `SELECT count(*) FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
        WHERE ls.class_id = '${CLASS_A}' AND ls.session_date = DATE '${PATTERN_DATE}'`
    )
  );
  check(
    "14 — the substitute can SAVE attendance (attendance_write is coach_is_main_on_session)",
    marks > 0,
    `${marks} attendance row(s)`
  );

  // gotoAuthed, not reload(): a bare reload of a nested route bounces to /login
  // while the root layout rehydrates the session (lib.mjs), and the screen then
  // has no roster on it at all — which reads as "the marks did not survive".
  await gotoAuthed(page, `${EXPO}/classes/${CLASS_A}/attendance?date=${PATTERN_DATE}`);
  await page.waitForTimeout(6000);
  mtext = await marking();
  const unmarkedAfter = (mtext.match(/Not yet marked/g) ?? []).length;
  // ⚠ COUNTED, NOT MATCHED. `/Present/.test(...)` was the first version of this
  // check and it is VACUOUS: "Present" is a button LABEL, on screen whether or
  // not anybody is marked, so it passed while zero rows had been written. The
  // assertion has to be about state that only a successful save can produce.
  check(
    "15 — and the marks survive a reload",
    mtext.includes(KID) && unmarkedAfter < unmarkedBefore,
    `unmarked ${unmarkedBefore} → ${unmarkedAfter}`
  );

  // ═══ C. THE SHADOW STAYS READ-ONLY ══════════════════════════════════════
  await freshLogin(SHADOW_EMAIL);
  await assertIdentity(SHADOW_EMAIL, "18a");
  await page.goto(`${EXPO}/classes/${CLASS_A}/attendance?date=${PATTERN_DATE}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(9000);
  mtext = await marking();
  check(
    "18 — a shadow SEES the lesson and gets no marking control",
    /shadowing this lesson/i.test(mtext) && !/Save Attendance/.test(mtext),
    "a roster a coach can fill in and never save is the failure `blocked` exists to prevent"
  );

  await browser.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
