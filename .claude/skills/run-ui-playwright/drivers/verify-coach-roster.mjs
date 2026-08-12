// verify-coach-roster.mjs — the coach roster, end to end.
//
// TWO DIFFERENT ARRANGEMENTS, AND THE DRIVER'S JOB IS THAT THEY STAY DIFFERENT:
//
//   · a SUBSTITUTE is one-off, on ONE lesson (`session_coaches`), assigned on
//     the Lesson Coaches page, and sees exactly the lesson they were named on;
//   · a SHADOW is a DATED assignment to a WHOLE CLASS (`class_shadow_coaches`,
//     20260812000200), assigned on the Classes page, and sees the class's whole
//     recurrence while marking none of it.
//
// They take OPPOSITE date sources, and a Schedule tab that reuses one for the
// other shows a shadow an empty week — indistinguishable from a quiet one.
//
// WHAT THIS OWNS. The wave shipped with pgTAP, vitest and jest coverage and
// NOTHING in the nightly sweep. Its failure mode is a guest the substitute
// cannot see, an incompletely marked lesson, and a billing month that will not
// close with no override (§8i) and nothing on any screen saying why. No unit
// test can reach that: it needs the real RLS path, in a browser, as a coach who
// is not the tenant admin.
//
// ⚠ THE SUBSTITUTE AND THE SHADOW ARE NON-ADMIN COACHES, AND THAT IS THE POINT
// (§7.131). `coach@swimsync.test` is deliberately also the tenant admin, so
// every `coach_branch OR can_admin_tenant(...)` policy answers through the admin
// branch on that account and no narrowing can be observed at all.
//
// ⚠ IT ALSO COLLIDES WITH verify-schedule-week ON A HAND-RUN. Both drivers put
// their lesson on the SAME WEEKDAY LAST WEEK, so leaving this fixture in place
// marks a date schedule-week expects to find unmarked, and its NEEDS MARKING
// check fails for a reason that has nothing to do with the Schedule tab.
// Measured: schedule-week scores 20/21 with this fixture present and 21/21
// without. The nightly sweep resets per driver, so this only bites by hand.
//
// ⚠ NOT RE-RUNNABLE BY HAND. Check 14 MARKS the fixture lesson and 14b writes
// an ABSENCE row, and check 0's positive control requires the lesson unmarked;
// the roster assignments are idempotent but the attendance is not. The shadow
// assignment is not either — `one_active_shadow_per_class_coach` refuses a
// second active row, so a re-run without the teardown fails at check 6b. Apply the teardown and the fixture again between
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
//   | Sabotage                                            | Score | Red     |
//   |-----------------------------------------------------|-------|---------|
//   | Rename session_shadow_coaches away (404 -> no list)  | 28/30 | 13c,14b |
//   | coach_is_active_class_shadow -> always FALSE         | 28/30 | 17b,18  |
//   | assignableClassShadows stops excluding the class     | 29/30 | 6       |
//   | coveredOutFrom -> new Set(asked): hide EVERYTHING    | 24/25 | 17      |
//   | DROP sessions_i_am_main_on (404 -> empty set)        | 24/25 | 16      |
//
// The last two rows were measured against the Wave 3 shape of this driver and
// are carried forward: neither the probe nor its guard changed, and rows 3 and
// 4 of that table were the two this file learned to distrust.
//
// TWO THINGS THAT TABLE BOUGHT, both of which were green-over-broken first:
//
//   · A sabotage of the covered-out probe scored a full 25/25 until the fixture
//     gave CLASS B's lesson a lesson_sessions row. The Schedule tab only probes
//     a backlog lesson that already has one, so with neither lesson probed,
//     "hide everything" changed nothing on screen and check 17 was decorative.
//   · Dropping sessions_i_am_main_on scored 25/25 until the replaced-coach
//     checks were moved BEFORE the substitute marks the lesson. A fully marked
//     lesson leaves the backlog whatever its roster says, so check 16 was
//     passing for a reason that had nothing to do with §7.134.
//
// ⚠ AND ONE THIS FILE'S REWRITE BOUGHT. Checks 13c and 14b were GREEN-OVER-
// NOTHING on the first run for a subtler reason than either of those: the
// driver assigned the shadow with the date field left at its default, so the
// assignment started TODAY and covered none of the fixture's past lessons. The
// Coaches-present list was correctly empty, and the checks were measuring an
// empty list rather than a working one. The fill of "Shadowing from" is not
// cosmetic — remove it and both go quiet again.
//
// If you reorder this driver, re-measure the last two rows. They are the ones
// that depend on the order rather than on the assertions.
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

  async function assign(label, coachName, p = ap) {
    await row(label, p)
      .getByRole("button", { name: /Assign a substitute|Change/ })
      .first()
      .click();
    await p.waitForTimeout(800);
    const sel = row(label, p).locator("select");
    await sel.selectOption({ label: coachName });
    await row(label, p).getByRole("button", { name: "Save" }).click();
    await p.waitForTimeout(2500);
  }

  await assign(LESSON_LABEL, SUB_NAME);
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

  // ═══ 5/6/6b/6c. A SHADOW BELONGS TO THE CLASS, NOT TO A LESSON ══════════
  // The surface MOVED (20260812000200): shadows are a dated assignment managed
  // on the Classes page, and Lesson Coaches is substitutes only. Both halves are
  // checked — that the new one works, and that the old one is really gone rather
  // than duplicated.
  const seedCoachName = sql(
    `SELECT p.full_name FROM classes c JOIN coaches co ON co.id = c.coach_id
       JOIN profiles p ON p.id = co.profile_id WHERE c.id = '${CLASS_A}'`
  );

  check(
    "5 — Lesson Coaches no longer offers 'Add shadow' at all",
    // ⚠ THE ROW MUST EXIST OR THIS IS TRUE FOR FREE. An absence assertion over a
    // page that failed to load passes while testing nothing (§7.101), so the
    // lesson label is asserted in the same breath as the button's absence.
    atext.includes(LESSON_LABEL) && !/Add shadow/.test(atext),
    "the per-lesson shadow is gone, not merely hidden"
  );

  await ap.goto(`${ADMIN}/classes`, { waitUntil: "domcontentloaded" });
  await ap.waitForTimeout(3000);
  await ap
    .locator("tr")
    .filter({ hasText: CLASS_A_TITLE })
    .getByRole("button", { name: /See students/ })
    .first()
    .click();
  await ap.waitForTimeout(2500);

  const shadowSelect = ap.locator("select").filter({ hasText: /Add a shadow/ });
  const offered = await shadowSelect.locator("option").allInnerTexts();
  check(
    "6 — the shadow dropdown does NOT offer the class's OWN coach",
    // The state assign_class_shadow() refuses: main by the absence rule and
    // shadow by a row is a lesson that is unmarkable AND un-nagged. Filtered in
    // the UI so a real admin never meets the refusal. `> 1` again because an
    // absence over an empty list is free.
    offered.length > 1 && !offered.includes(seedCoachName),
    `offered: ${offered.filter((o) => /RosterCov|Marcus/.test(o)).join(", ") || "(nobody named)"}`
  );

  await shadowSelect.selectOption({ label: SHADOW_NAME });
  // ⚠ BACKDATED TO THE LESSON, NOT LEFT AT TODAY'S DEFAULT. Pay asks "was this
  // coach assigned when the lesson RAN", so an assignment starting today covers
  // none of the fixture's past lessons — the Coaches-present list would be
  // correctly empty and checks 13c/14b would be testing nothing while passing
  // for the wrong reason.
  await ap.locator('input[aria-label="Shadowing from"]').fill(PATTERN_DATE);
  await ap.getByRole("button", { name: "Add", exact: true }).first().click();
  await ap.waitForTimeout(3000);
  atext = await ap.locator("body").innerText();
  check(
    "6b — a shadow is assigned to the CLASS and shown as ongoing",
    atext.includes(SHADOW_NAME) && /ongoing/i.test(atext),
    "dated from today; pay reads the range, visibility reads today"
  );

  const offeredAfter = await shadowSelect.locator("option").allInnerTexts();
  check(
    "6c — …and is no longer offered, so the unique index cannot be hit",
    offeredAfter.length >= 1 && !offeredAfter.includes(SHADOW_NAME),
    "one_active_shadow_per_class_coach surfaces as a raw 23505 otherwise"
  );

  const assigned = Number(
    sql(
      `SELECT count(*) FROM class_shadow_coaches
        WHERE class_id = '${CLASS_A}' AND effective_to IS NULL`
    )
  );
  check(
    "7 — …and the row really landed, dated and open-ended",
    assigned === 1,
    `${assigned} active assignment(s)`
  );

  await ap.goto(`${ADMIN}/lesson-coaches`, { waitUntil: "domcontentloaded" });
  await ap.waitForTimeout(2500);
  await openRoster();
  await row(LESSON_LABEL).getByRole("button", { name: "Clear" }).first().click();
  await ap.waitForTimeout(2500);
  atext = await ap.locator("body").innerText();
  check(
    "7b — Clear returns the lesson to the class's own coach",
    /is back with/.test(atext) && /class coach/.test(atext),
    atext.match(/[^\n]*is back with[^\n]*/)?.[0] ?? ""
  );

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
  await assign(LESSON_LABEL, SUB_NAME);
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
  // ── COACHES PRESENT — the shadow's pay, recorded by the person who knows ──
  // ⚠ PRE-TICKED, AND THAT IS THE SAFETY ARGUMENT, NOT A CONVENIENCE. A blank
  // list is an opt-in, and forgetting an opt-in silently costs the shadow a
  // lesson's pay — invisible on every screen. Forgetting an opt-OUT overpays,
  // which shows up as a line on the Wages page and can be seen.
  check(
    "13c — the marking coach sees a COACHES PRESENT section naming the shadow",
    /Coaches present/i.test(mtext) && mtext.includes(SHADOW_NAME),
    "the only person who knows whether the trainee turned up is the one marking"
  );

  // Untick, then save: a row means ABSENT (no row means present and paid).
  await pressByText(page, SHADOW_NAME);
  await page.waitForTimeout(1200);

  await pressByText(page, "Save Attendance");
  await page.waitForTimeout(5000);

  const absences = Number(
    sql(
      `SELECT count(*) FROM session_coach_absences a
         JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
        WHERE ls.class_id = '${CLASS_A}' AND ls.session_date = DATE '${PATTERN_DATE}'`
    )
  );
  check(
    "14b — unticking the shadow writes an ABSENCE row, so payroll skips that lesson",
    absences === 1,
    `${absences} absence row(s) — a row means NOT there; no row means paid`
  );
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

  // ═══ C. THE SHADOW SEES THE WHOLE CLASS, AND MARKS NONE OF IT ═══════════
  await freshLogin(SHADOW_EMAIL);
  await assertIdentity(SHADOW_EMAIL, "18a");

  // ⚠ THE OPPOSITE DATE SOURCE FROM A SUBSTITUTE, AND THE ONLY CHECK THAT SAYS
  // SO. A substitute sees exactly the lessons they were named on; a class shadow
  // sees the class's whole recurrence and holds NO per-lesson rows at all — so a
  // Schedule tab that reuses the substitute's arm shows them an empty week
  // (plan RISK 8). `rosteredDatesByClass` returning nothing is what that looks
  // like, and it is indistinguishable from a quiet week.
  text = await schedule();
  check(
    "17b — the shadow's week shows the class they shadow",
    text.includes(CLASS_A_TITLE),
    "a shadow takes the class's recurrence, not a per-lesson row they do not have"
  );
  check(
    "17c — …and NOT the class they do not shadow",
    !text.includes(CLASS_B_TITLE),
    "the assignment is per-class, so it must not leak the coach's other classes"
  );
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
