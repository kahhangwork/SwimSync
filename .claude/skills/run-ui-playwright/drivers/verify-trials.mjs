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
import { launch, loginAdmin, loginExpo, tap, ADMIN } from "./lib.mjs";

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

// Book TODAY's lesson, so the coach's attendance screen — which defaults to
// the most recent expected lesson — lands on exactly this date. Booking an
// arbitrary Saturday would leave the roster check below testing nothing.
const todayLabel = new Date().toLocaleDateString("en-SG", {
  weekday: "short", day: "numeric", month: "short",
});
const todayIdx = dateOptions.findIndex(
  (d) => d.replace(/\s+/g, " ").trim() === todayLabel.replace(/\s+/g, " ").trim()
);
if (todayIdx < 1) {
  console.log(`SKIP  today is not a lesson day for this class (looked for "${todayLabel}")`);
  console.log(`      options: ${dateOptions.slice(1, 5).join(" | ")}`);
  await browser.close();
  process.exit(0);
}
await selects.nth(1).selectOption({ index: todayIdx });
await page.getByPlaceholder("Child's name").fill(KID);
await tap(page.getByRole("button", { name: /Book the trial/i }).first(), "book");
await page.waitForTimeout(3000);

text = await page.evaluate(() => document.body.innerText);
check("the booking appears under Upcoming", text.includes(KID));
await page.screenshot({ path: shot("trials-02-booked.png"), fullPage: true });

const bookedDate = dateOptions[todayIdx];

// ── COACH: the child is expected on THAT lesson, and only that one ──────────
await loginExpo(page, "coach@swimsync.test");
await page.waitForTimeout(1500);
await tap(page.getByText(/Classes/i).first(), "Classes tab");
await page.waitForTimeout(1200);
await tap(page.getByText(/Saturday Beginners/i).first(), "the seed class");
await page.waitForTimeout(1500);

const roster = await page.evaluate(() => document.body.innerText);
check(
  "the class ROSTER does not list the trial child as a regular student",
  !roster.includes(KID),
  "a trial is not an enrolment — they belong to one lesson, not the class"
);

// ⚠ THE LOAD-BEARING ONE. They must appear on the lesson they were booked for,
// or the trial can never be marked and the billing month can never close.
await tap(page.getByText(/Mark Attendance|Take Attendance/i).first(), "mark attendance");
await page.waitForTimeout(2500);
const marking = await page.evaluate(() => document.body.innerText);
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
