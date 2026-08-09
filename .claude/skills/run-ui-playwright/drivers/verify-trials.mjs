// Trials as bookings, end to end through both real UIs.
//
// THE LOAD-BEARING ASSERTIONS are the two halves of "expected at ONE lesson":
// the booked child appears on the coach's roster for THAT date, and does NOT
// appear on the class's next lesson. Get the first wrong and the trial can
// never be marked, so the billing month can never close; get the second wrong
// and the child is expected every week forever.
//
// It also pins the refusals that live in the RPC rather than the UI — a limit
// only the admin screen applies is not a limit (§7.32).
//
// Setup: supabase running + seed; SwimSyncAdmin npm run dev; SwimSyncApp expo web.
import os from "node:os";
import path from "node:path";
import {
  launch,
  loginAdmin,
  loginExpo,
  tap,
  pressByTextMatch,
  visibleText,
  ADMIN,
} from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (l, p, d = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
};

const KID = `Trial Kid ${Date.now()}`;
const { browser, page } = await launch();

// ── ADMIN: the reminder, then book ──────────────────────────────────────────
await loginAdmin(page, "coach@swimsync.test");
await page.goto(`${ADMIN}/trials`);
await page.waitForTimeout(2500);

let text = await page.evaluate(() => document.body.innerText);
check(
  "the unpriced-category reminder is shown on a fresh business",
  /Set a price for/i.test(text),
  "both default categories start unpriced"
);
check("the trial-prices table lists the categories", /Default Group/i.test(text));
await page.screenshot({ path: shot("trials-01-reminder.png"), fullPage: true });

// Price one category — a new effective-dated row, not an overwrite.
const rateInput = page.getByLabel(/New trial price for Default Group/i);
await rateInput.fill("12");
await tap(page.getByRole("button", { name: /^Save$/ }).first(), "save the trial price");
await page.waitForTimeout(2500);
text = await page.evaluate(() => document.body.innerText);
check("the saved price is shown", /S\$12\.00/.test(text));
check(
  "and the reminder now names only the remaining unpriced category",
  /Set a price for/i.test(text) && !/Default Group,/.test(text),
  "it disappears per-category, not all at once"
);

// Book a trial. The seed class is Saturday, so the picker must offer Saturdays.
await tap(page.getByRole("button", { name: /Book a trial/i }).first(), "open the form");
await page.waitForTimeout(600);
const selects = page.locator('select');
await selects.nth(0).selectOption({ index: 1 }); // class
await page.waitForTimeout(400);

const dateOptions = await selects.nth(1).locator("option").allTextContents();
check(
  "the lesson picker offers only that class's days",
  dateOptions.slice(1).every((d) => /Sat/i.test(d)),
  dateOptions.slice(1, 4).join(" | ")
);

// Book the most recent lesson that has already fallen due, because that is what
// the coach has to MARK — an unmarked one blocks the month, which is this
// driver's whole subject. Booking an arbitrary future Saturday would put the
// lesson in COMING UP, where none of the checks below have anything to read.
//
// ⚠ THIS USED TO REQUIRE TODAY TO *BE* A SATURDAY, AND EXITED 0 OTHERWISE — so
// the coach half ran one day in seven and the nightly reported PASS on the other
// six without reaching a single check. Worse, the day came from `new Date()` in
// the RUNNER's zone (§7.100, §7.7 on the driver's side of the wire): CI is UTC,
// so it "found" Saturday while Singapore was already Sunday.
//
// Compare ISO option VALUES, never the rendered labels — a label is a locale
// away from being a different string, and the value is the date itself.
const dateValues = await selects
  .nth(1)
  .locator("option")
  .evaluateAll((os) => os.map((o) => o.value));
const todaySg = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Singapore",
});
let targetIdx = -1;
for (let i = 1; i < dateValues.length; i++) {
  if (dateValues[i] && dateValues[i] <= todaySg) targetIdx = i;
}
// A FAILURE, NOT A SKIP — and that distinction is the point of §7.100. The
// picker offers three weeks BACK (`trials/page.tsx` datesFor: shift(-21)), so a
// weekly class always has a past lesson to book and this branch cannot be
// reached by the calendar. Reaching it means the picker changed. Exiting 0 here
// would hand the sweep a PASS for a run that asserted nothing, which is exactly
// how the phone-field bug below survived two weeks of green nightlies.
check(
  "the picker offers a lesson that has already fallen due",
  targetIdx >= 1,
  `today SGT ${todaySg} · options: ${dateOptions.slice(1, 5).join(" | ")}`
);
if (targetIdx < 1) {
  await browser.close();
  process.exit(1);
}
await selects.nth(1).selectOption({ index: targetIdx });
await page.getByPlaceholder("Child's name").fill(KID);
// ⚠ THE PHONE IS REQUIRED, AND THIS DRIVER SILENTLY DID NOT FILL IT FOR TWO
// WEEKS. §8.12 made a contact number mandatory on both create forms — a name is
// written too many ways to be the matching signal — and the form refuses with
// "A contact number is needed…" before book_trial() is ever called. Every check
// after this one then fails for a reason that has nothing to do with what they
// assert. It hid because the driver skipped itself six days in seven (below).
await page.getByPlaceholder(/Parent's phone/i).fill("91234567");
await tap(page.getByRole("button", { name: /Book the trial/i }).first(), "book");
await page.waitForTimeout(3000);

// "Listed", not "under Upcoming": the target lesson is the most recent one that
// has fallen due, so it is normally in the past and lands under "Past — needs
// marking". Both halves are the same page and the same assertion.
text = await page.evaluate(() => document.body.innerText);
check("the booking is listed on the Trials page", text.includes(KID));
await page.screenshot({ path: shot("trials-02-booked.png"), fullPage: true });

const bookedDate = `${dateOptions[targetIdx]} (${dateValues[targetIdx]})`;

// ── COACH: the child is expected on THAT lesson, and only that one ──────────
await loginExpo(page, "coach@swimsync.test");
await page.waitForTimeout(1500);
await tap(page.getByText(/Classes/i).first(), "Classes tab");
await page.waitForTimeout(1200);
await tap(page.getByText(/Saturday Beginners/i).first(), "the seed class");
await page.waitForTimeout(1500);

// visibleText, not body.innerText: the Schedule tab stays MOUNTED underneath
// this screen (§7.98), and it lists trial bookings — so a stale mount can both
// break this negative check and satisfy the positive ones below without the
// screen under test ever having loaded.
const roster = await visibleText(page);
check(
  "the class ROSTER does not list the trial child as a regular student",
  !roster.includes(KID),
  "a trial is not an enrolment — they belong to one lesson, not the class"
);

// ⚠ THE LOAD-BEARING ONE. They must appear on the lesson they were booked for,
// or the trial can never be marked and the billing month can never close.
//
// REACHED FROM THE SCHEDULE TAB, NOT FROM THIS ROSTER, AND THAT IS A PRODUCT
// FACT RATHER THAN A DRIVER PREFERENCE. The roster's "Mark Attendance" button
// is gated on `activeStudentIds.length > 0` (roster.tsx) — ENROLMENTS only — so
// a class whose only attendee on a date is a guest renders no lessons and no
// button. The Schedule tab has no such gate: it derives who is expected from
// `expectedStudentsOn()`, which counts bookings, so a trial-only lesson lands
// in NEEDS MARKING. That is the coach's route to it, so it is the one to pin.
//
// A NEEDS MARKING row's button reads "Mark", not "Mark Attendance", so
// `pressClassButton` cannot reach it — its regex ignores "Mark" on purpose, to
// keep a walk that starts at a NEEDS MARKING copy of a title from climbing out
// and pressing a different card's button (§7.98). Press the label itself, on
// the VISIBLE screen and only when it is unique: "Mark" is exact, so neither
// "Not marked" nor "NEEDS MARKING (1)" nor a TODAY row's "Mark Attendance"
// collides with it.
await tap(page.getByText(/^Schedule$/).first(), "Schedule tab");
await page.waitForTimeout(2000);
check(
  "the trial-only lesson is reachable from NEEDS MARKING",
  await pressByTextMatch(page, /^Mark$/),
  "a class with no enrolled students still has a guest to mark"
);
await page.waitForTimeout(2500);
const marking = await visibleText(page);
check(
  "the booked child IS on the attendance screen for their own lesson",
  marking.includes(KID),
  "without this the trial is unmarkable and the month never closes"
);
check(
  "and is labelled Trial, not left looking like a regular",
  /Trial/.test(marking),
  "the status the coach picks decides what the family is charged"
);
await page.screenshot({ path: shot("trials-03-coach-marking.png"), fullPage: true });

await browser.close();

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(`booked lesson: ${bookedDate}`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
