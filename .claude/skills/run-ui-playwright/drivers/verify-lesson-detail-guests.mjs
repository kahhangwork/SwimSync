// verify-lesson-detail-guests.mjs — the admin lesson page's actions no other
// driver presses (/lessons/[classId]/[date]): book a TRIAL into a lesson and
// Cancel booking on the guest row; a make-up for a child with TWO same-category
// homes (the "which class does this make-up replace?" select, its client
// refusal, and the home class the booking carries); the Book modal's
// full-notice; the invalid-date and unknown-class states; Keep the lesson; the
// assign-substitute ERROR branch; Set all, and the Rain/Coach + Paid/Free
// sub-toggles, saved and read back.
//
// Fixture: fixtures-lesson-detail-guests.sql   Teardown: fixtures-lesson-detail-guests-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U2. BACKLOG item: "A verify-lesson-detail-guests driver…".
//
// Logs in as lesson-guests-owner@swimsync.test — the owner-admin of the
// fixture's OWN business, so Set all, the bookings and the cancel modal touch
// nothing the calendar / lesson-detail / cancel-lesson drivers read (rule 12).
//
// WEEKDAY- AND HOUR-INDEPENDENT. Every fixture class runs on TODAY's weekday
// (SGT), and the driver reads today / last week / next week from the DB — never
// JS local time. Last week's lesson is always inside the markable window (the
// floor is the 1st of LAST month) and next week's always bookable. Nothing on
// this admin page buckets by time of day, so no clock pin is needed (rule 13).
//
// WHY THESE. A guest's HOME class prices its invoice line, so the multi-home
// make-up is asserted on makeup_bookings.home_class_id, not on the toast; Cancel
// booking removes a line from next month's bill; Set all writes every editable
// row at once. Each write is a before/after pair on a scoped query (rule 5).
//
// The assign-substitute error is FORCED with page.route on the RPC (rule 9):
// method-scoped (POST), asserted hit exactly once, unrouted straight after.
//
// RE-RUN: re-load the fixture first (it RESETS every write this driver makes).
// A re-run on a dirty DB fails on its first PRECONDITION, by design (rule 5).
//
// No window.confirm/prompt on these paths — "Keep the lesson" is a Modal button.
// It is still paired with a DB-unchanged assert (rule 8's spirit, §7.279).
//
// MUTATION PROOFS (§7.25) — each made on app code, run, seen red, reverted
// (`git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean after):
//
//   | # | mutation                                                          | result | red checks |
//   |---|-------------------------------------------------------------------|--------|------------|
//   | 1 | domain/useGuestBooking.ts:53 → `bookMakeup(…, null)` (no home)    | 9/29   | "the make-up carries the CHOSEN home class" (no booking — the RPC refuses to guess between two homes); the client refusal above it stays GREEN, which is why the DB assert is the proof |
//   | 2 | domain/useSubstitute.ts:45 → delete `setCoachMsg(…)`              | 28/29  | "a refused assign shows \"Could not assign: forced by driver\"" |
//
// (2026-09-26, both reverted; `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean. Mutation 1's
// later reds are its cascade: no make-up row to cancel, so the run stops there.)

import { execFileSync } from "node:child_process";
import { launch, loginAdmin, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
for (const u of [ADMIN, EXPO]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) {
    console.error(`refusing to run against a non-local URL: ${u}`);
    process.exit(2);
  }
}

const EXPECTED_CHECKS = 29;

const DB = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split("\n").find((n) => n.startsWith("supabase_db_"));
if (!DB) throw new Error("no running supabase_db_* container — `supabase start` first");
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-Atc", q], { encoding: "utf8" }).trim();
// Poll until the DB value satisfies `ok` — a UI write lands asynchronously.
async function dbUntil(q, ok, ms = 10000) {
  const end = Date.now() + ms;
  let v = sql(q);
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    v = sql(q);
  }
  return v;
}

const HOST = "b3000000-0000-0000-0000-0000000000c1";
const LATE = "b3000000-0000-0000-0000-0000000000c3";
const FULL = "b3000000-0000-0000-0000-0000000000c4";
const TRIALKID = "b3000000-0000-0000-0000-0000000000d1";
const PASTTRIAL = "b3000000-0000-0000-0000-0000000000d2";
const TWOHOME = "b3000000-0000-0000-0000-0000000000d3";
const AMY = "b3000000-0000-0000-0000-0000000000d4";
const BEN = "b3000000-0000-0000-0000-0000000000d5";
const NO_SUCH_CLASS = "b3000000-0000-0000-0000-0000000000ff";
const FORCED = "forced by driver";

// Dates from the DB (rule 4 / §7.7), never from JS local time.
const [TODAY, NEXT, LAST] = sql(
  `SELECT t||'|'||(t+7)||'|'||(t-7) FROM (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS t) s`
).split("|");
console.log(`today ${TODAY}, next week ${NEXT}, last week ${LAST}`);

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
// The Modal primitive has no role; its overlay is the fixed z-50 layer.
const modal = (page) => page.locator("div.fixed.inset-0.z-50").last();
const row = (page, sid) => page.locator(`[data-testid="roster-row"][data-student="${sid}"]`);
const pressed = async (page, sid, status) =>
  (await row(page, sid).locator(`[data-status="${status}"]`).getAttribute("aria-pressed", { timeout: 5000 })
    .catch(() => null)) === "true";
const count = (page) => page.getByTestId("lesson-count").innerText({ timeout: 5000 }).catch(() => "(no count)");
async function openLesson(page, classId, date) {
  await page.goto(`${ADMIN}/lessons/${classId}/${date}`, { waitUntil: "networkidle" });
  await page.getByTestId("save-attendance").waitFor({ timeout: 15000 });
}

const { browser, page } = await launch({ headless: true });
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
if (process.env.SHOT_DIR) console.log("shots:", process.env.SHOT_DIR);

try {
  // ── 0. The fixture is as loaded ────────────────────────────────────────────
  const guestsNextQ = `SELECT (SELECT count(*) FROM trial_bookings WHERE class_id='${HOST}' AND session_date='${NEXT}')
                      ||'/'||(SELECT count(*) FROM makeup_bookings WHERE class_id='${HOST}' AND session_date='${NEXT}')`;
  const sessionsQ = `SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'b3000000-%'`;
  check("PRECONDITION: no guest booked into next week's Host lesson, and no fixture lesson has a session row",
    sql(guestsNextQ) === "0/0" && sql(sessionsQ) === "0", `trials/makeups ${sql(guestsNextQ)}, sessions ${sql(sessionsQ)}`);

  await loginAdmin(page, "lesson-guests-owner@swimsync.test");

  // ── 1. The two refusal states ─────────────────────────────────────────────
  await page.goto(`${ADMIN}/lessons/${HOST}/not-a-date`, { waitUntil: "networkidle" });
  const invalid = await page.getByText("That date isn't valid.").waitFor({ timeout: 10000 })
    .then(() => true).catch(() => false);
  check("an invalid date reads \"That date isn't valid.\" with no Save", invalid &&
    (await page.getByTestId("save-attendance").count()) === 0);

  await page.goto(`${ADMIN}/lessons/${NO_SUCH_CLASS}/${TODAY}`, { waitUntil: "networkidle" });
  const unknown = await page.getByText("That class does not exist, or is not in your business.")
    .waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("an unknown class reads \"That class does not exist, or is not in your business.\"", unknown &&
    (await page.getByTestId("save-attendance").count()) === 0);

  // ── 2. Book a TRIAL into next week's Host lesson ──────────────────────────
  await openLesson(page, HOST, NEXT);
  await page.getByRole("button", { name: "Book a trial into this lesson" }).click();
  const trialOpts = (await modal(page).getByLabel("Trial child").locator("option").allInnerTexts()).join(",");
  check("the trial picker offers exactly the two children not in a class (visible under RLS)",
    /\(2\)/.test(trialOpts) && trialOpts.includes("LGuest Trialkid") && trialOpts.includes("LGuest Pasttrial"),
    trialOpts);
  await modal(page).getByLabel("Trial child").selectOption(TRIALKID);
  await page.getByTestId("book-guest").click();
  const trialQ = `SELECT count(*) FROM trial_bookings WHERE student_id='${TRIALKID}' AND class_id='${HOST}'
                    AND session_date='${NEXT}' AND cancelled_at IS NULL`;
  const trialBooked = await dbUntil(trialQ, (v) => v === "1");
  check("Book writes ONE live trial booking for that child, class and date", trialBooked === "1", `rows ${trialBooked}`);
  await row(page, TRIALKID).waitFor({ timeout: 10000 }).catch(() => {});
  const trialRow = await row(page, TRIALKID).innerText({ timeout: 3000 }).catch(() => "(no row)");
  check("…and the child joins the roster with a Trial chip, counted as a guest (2+1/6)",
    /LGuest Trialkid/.test(trialRow) && /Trial/i.test(trialRow) && /2\+1\/6/.test(await count(page)),
    `${trialRow.replace(/\s+/g, " ").slice(0, 60)} · ${await count(page)}`);

  // ── 3. A make-up for a child with TWO same-category homes ─────────────────
  const makeupQ = `SELECT coalesce(string_agg(class_id||'/'||home_class_id, ','), '') FROM makeup_bookings
                    WHERE student_id='${TWOHOME}' AND cancelled_at IS NULL`;
  await page.getByRole("button", { name: "Book a make-up into this lesson" }).click();
  await modal(page).getByLabel("Child", { exact: true }).selectOption(TWOHOME);
  const homeSel = modal(page).getByLabel("Which class does this make-up replace");
  const homeOpts = (await homeSel.locator("option").allInnerTexts().catch(() => [])).join(",");
  check("a child in TWO same-category classes is asked which class the make-up replaces",
    homeOpts === "Which class does this make-up replace?,LGuest Early,LGuest Late", homeOpts);

  await page.getByTestId("book-guest").click();
  const refusal = await modal(page).getByText("Choose which class this make-up replaces.")
    .waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  check("pressing Book without choosing is refused on the page, and says why", refusal);
  await page.waitForTimeout(1000); // give a wrongly-sent booking time to land before reading "none"
  check("…and the refusal wrote NO booking", sql(makeupQ) === "", sql(makeupQ) || "(none)");

  await homeSel.selectOption(LATE);
  await page.getByTestId("book-guest").click();
  const booked = await dbUntil(makeupQ, (v) => v !== "");
  check("⚠ the make-up carries the CHOSEN home class (Late), hosted by Host",
    booked === `${HOST}/${LATE}`, `class/home = ${booked || "(no booking)"}`);
  await row(page, TWOHOME).waitFor({ timeout: 10000 }).catch(() => {});
  const mkRow = await row(page, TWOHOME).innerText({ timeout: 3000 }).catch(() => "(no row)");
  check("…and the child joins the roster with a Make-up chip (2+2/6)",
    /Make-up/i.test(mkRow) && /2\+2\/6/.test(await count(page)),
    `${mkRow.replace(/\s+/g, " ").slice(0, 60)} · ${await count(page)}`);

  // ── 4. Cancel booking on each guest row ───────────────────────────────────
  await row(page, TRIALKID).getByRole("button", { name: "Cancel booking" }).click();
  const trialLive = await dbUntil(trialQ, (v) => v === "0");
  check("Cancel booking on the TRIAL row cancels that booking (cancelled_at set)",
    trialLive === "0" && sql(`SELECT count(*) FROM trial_bookings WHERE student_id='${TRIALKID}' AND cancelled_at IS NOT NULL`) === "1",
    `live ${trialLive}`);
  await row(page, TRIALKID).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  check("…and the row leaves the roster (2+1/6)",
    (await row(page, TRIALKID).count()) === 0 && /2\+1\/6/.test(await count(page)), await count(page));

  await row(page, TWOHOME).getByRole("button", { name: "Cancel booking" }).click();
  const mkLive = await dbUntil(makeupQ, (v) => v === "");
  check("Cancel booking on the MAKE-UP row cancels it; the lesson is back to 2/6",
    mkLive === "" &&
      sql(`SELECT count(*) FROM makeup_bookings WHERE student_id='${TWOHOME}' AND cancelled_at IS NOT NULL`) === "1" &&
      (await row(page, TWOHOME).waitFor({ state: "detached", timeout: 10000 }).then(() => true).catch(() => false)) &&
      /^2\/6/.test(await count(page)),
    `live ${mkLive || "(none)"} · ${await count(page)}`);

  // ── 5. Assign a substitute: the ERROR branch (forced, rule 9) ─────────────
  const subsQ = `SELECT count(*) FROM session_coaches sc JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
                  WHERE ls.class_id='${HOST}'`;
  const subOpts = (await page.getByLabel("Substitute coach").locator("option").allInnerTexts()).join(",");
  check("PRECONDITION: no substitute on any Host lesson, and LGuest Sub is the one offered",
    sql(subsQ) === "0" && subOpts === "Choose a substitute…,LGuest Sub", `subs ${sql(subsQ)}, options ${subOpts}`);
  let hits = 0;
  const RPC = "**/rest/v1/rpc/assign_session_coach*";
  const handler = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    hits++;
    await route.fulfill({ status: 400, contentType: "application/json",
      body: JSON.stringify({ message: FORCED, code: "P0001" }) });
  };
  await page.route(RPC, handler);
  await page.getByLabel("Substitute coach").selectOption({ label: "LGuest Sub" });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  const shown = await page.getByText(`Could not assign: ${FORCED}`, { exact: true })
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  await page.unroute(RPC, handler);
  check(`⚠ a refused assign shows "Could not assign: ${FORCED}" under the picker`, shown);
  check("…the forced route was hit exactly once, and nothing was written",
    hits === 1 && sql(subsQ) === "0" && sql(sessionsQ) === "0", `hits ${hits}, subs ${sql(subsQ)}, sessions ${sql(sessionsQ)}`);

  // ── 6. The FULL lesson: the Book modal's full-notice; Keep the lesson ─────
  await openLesson(page, FULL, NEXT);
  await page.getByRole("button", { name: "Book a trial into this lesson" }).click();
  const notice = await modal(page).getByTestId("full-notice").innerText({ timeout: 5000 }).catch(() => "(no notice)");
  check("the Book modal on a FULL lesson warns before booking, naming the count",
    /This lesson is full \(1\/1\)/.test(notice) && /raise the class's maximum/.test(notice), notice.slice(0, 90));
  await modal(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByTestId("full-notice").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  const fullSessQ = `SELECT count(*) FROM lesson_sessions WHERE class_id='${FULL}' AND session_date='${NEXT}'`;
  check("PRECONDITION: next week's Full lesson has no session row (not cancelled)", sql(fullSessQ) === "0", sql(fullSessQ));
  await page.getByTestId("cancel-lesson").click();
  await page.getByTestId("cancel-reason").fill("LGuest driver: should be kept");
  await modal(page).getByRole("button", { name: "Keep the lesson" }).click();
  const closed = await page.getByTestId("cancel-reason").waitFor({ state: "detached", timeout: 5000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(1000); // a wrongly-sent cancel would land in this window
  check("Keep the lesson closes the modal and cancels NOTHING (no session row, Cancel still offered, no banner)",
    closed && sql(fullSessQ) === "0" && (await page.getByTestId("cancel-lesson").count()) === 1 &&
      (await page.getByTestId("lesson-cancelled").count()) === 0,
    `modal closed ${closed}, sessions ${sql(fullSessQ)}`);

  // ── 7. Last week's Host lesson: Set all + the sub-toggles, saved ──────────
  const marksQ = `SELECT coalesce(string_agg(a.student_id||':'||a.status, ',' ORDER BY a.student_id), '')
                    FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
                   WHERE ls.class_id='${HOST}' AND ls.session_date='${LAST}'`;
  check("PRECONDITION: last week's Host lesson has no marks", sql(marksQ) === "", sql(marksQ) || "(none)");
  await openLesson(page, HOST, LAST);
  const rows = await page.getByTestId("roster-row").count();
  const trialGuest = await row(page, PASTTRIAL).innerText({ timeout: 5000 }).catch(() => "");
  check("PRECONDITION: three rows (Amy, Ben, and Pasttrial as a TRIAL guest), none marked",
    rows === 3 && /Trial/i.test(trialGuest) &&
      (await page.locator('[data-testid="roster-row"] [aria-pressed="true"]').count()) === 0,
    `rows ${rows}`);

  await page.getByLabel("Set all to").selectOption("absent");
  const allAbsent = (await pressed(page, AMY, "absent")) && (await pressed(page, BEN, "absent")) &&
    (await pressed(page, PASTTRIAL, "absent"));
  check("Set all → Absent presses Absent on EVERY row, the trial guest included", allAbsent);

  await row(page, AMY).locator('[data-status="cancelled"]').click();
  check("Cancelled opens the reason toggle on Rain by default",
    (await pressed(page, AMY, "cancelled_rain")) && !(await pressed(page, AMY, "cancelled_coach")));
  await row(page, AMY).getByRole("button", { name: "Coach", exact: true }).click();
  check("…and Coach switches it (Coach pressed, Rain not)",
    (await pressed(page, AMY, "cancelled_coach")) && !(await pressed(page, AMY, "cancelled_rain")));

  await row(page, PASTTRIAL).locator('[data-status="trial"]').click();
  const paidFirst = (await pressed(page, PASTTRIAL, "trial_paid")) && !(await pressed(page, PASTTRIAL, "trial_free"));
  await row(page, PASTTRIAL).getByRole("button", { name: "Free", exact: true }).click();
  check("Trial opens on Paid by default, and Free switches it",
    paidFirst && (await pressed(page, PASTTRIAL, "trial_free")) && !(await pressed(page, PASTTRIAL, "trial_paid")),
    `paid first ${paidFirst}`);

  await page.getByTestId("save-attendance").click();
  const saveMsg = await page.getByTestId("save-message").innerText({ timeout: 15000 }).catch(() => "(no message)");
  check("Save reports the three marks", /Saved 3 marks/.test(saveMsg), saveMsg);
  const marks = await dbUntil(marksQ, (v) => v.split(",").length === 3);
  check("DB: Amy cancelled_coach, Ben absent, Pasttrial trial_free",
    marks === `${PASTTRIAL}:trial_free,${AMY}:cancelled_coach,${BEN}:absent`, marks || "(none)");

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || ").slice(0, 200));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/lesson-detail-guests-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
