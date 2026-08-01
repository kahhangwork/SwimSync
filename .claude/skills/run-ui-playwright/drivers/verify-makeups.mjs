// Make-ups as bookings, end to end through both real UIs.
//
// THE LOAD-BEARING ASSERTIONS mirror verify-trials.mjs: the booked guest
// appears where the lesson is handled (the host class's "Make-ups coming up"
// panel and, when the booking is for today, its marking screen) and does NOT
// appear as a member of the host class. The guest's NAME rendering is itself
// an assertion: coach_serves_student() had to be widened for guests, and
// RN-web's .filter(Boolean) silently drops an RLS-hidden name.
//
// Also pinned via the real UI: the booking form's structural guards (the class
// list excludes the child's own class; the date list is the host's real lesson
// days) and one RPC refusal surfaced verbatim (the duplicate slot) — a limit
// only the admin screen applies is not a limit (§7.32).
//
// Coach screens are reached by fixed-id DEEP LINKS (the verify-attendance-guard
// pattern): tab-bar taps force-click whatever screen physically overlays
// (§7.58), and both fixture classes carry fixed ids for exactly this.
//
// Setup: supabase running + seed; fixtures-makeups.sql loaded (RE-LOAD the
// fixture between runs — the driver books through the UI, so a second run
// against the same state hits its own duplicate-slot refusal);
// SwimSyncAdmin npm run dev; SwimSyncApp expo web.
import os from "node:os";
import path from "node:path";
import { launch, loginAdmin, loginExpo, gotoAuthed, tap, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (l, p, d = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
};

const KID = "Makeupvis Kid";
const HOST_ID = "7e0c1a55-0000-0000-0000-000000000002"; // Makeup Host Saturday
const HOST_TITLE = "Makeup Host Saturday";
const HOME_TITLE = "Makeup Home Sunday";

// The booking is always for TODAY (SGT): the fixture schedules an
// off-schedule host session on today's date, which the picker offers and
// book_makeup() accepts — so the coach marking-screen checks run on every
// run, whatever the weekday.
const sgNow = new Date(Date.now() + 8 * 3600 * 1000); // SGT = UTC+8, no DST
const BOOK_ISO = sgNow.toISOString().slice(0, 10);
const BOOK_LABEL = new Date(`${BOOK_ISO}T12:00:00+08:00`)
  .toLocaleDateString("en-SG", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Singapore",
  });

const { browser, page } = await launch();

// ── ADMIN: book the guest ───────────────────────────────────────────────────
await loginAdmin(page, "coach@swimsync.test");
await page.goto(`${ADMIN}/makeups`);
await page.waitForTimeout(2500);

let text = await page.evaluate(() => document.body.innerText);
check("the Make-ups page renders", /Make-ups/.test(text));
await page.screenshot({ path: shot("makeups-01-page.png"), fullPage: true });

await tap(page.getByRole("button", { name: /Book a make-up/i }).first(), "open the form");
await page.waitForTimeout(600);

const selects = page.locator("select");
const kidOptions = await selects.nth(0).locator("option").allTextContents();
check(
  "the child list names the home class beside the child",
  kidOptions.some((o) => o.includes(KID) && o.includes(HOME_TITLE)),
  kidOptions.filter((o) => o.includes(KID)).join(" | ")
);
const kidIdx = kidOptions.findIndex((o) => o.includes(KID));
await selects.nth(0).selectOption({ index: kidIdx });
await page.waitForTimeout(400);

const classOptions = await selects.nth(1).locator("option").allTextContents();
check(
  "the class list offers the same-category hosts and EXCLUDES the child's own class",
  classOptions.some((o) => o.includes(HOST_TITLE)) &&
    !classOptions.some((o) => o.includes(HOME_TITLE)),
  classOptions.slice(1).join(" | ")
);
const hostIdx = classOptions.findIndex((o) => o.includes(HOST_TITLE));
await selects.nth(1).selectOption({ index: hostIdx });
await page.waitForTimeout(400);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const dateOptions = await selects.nth(2).locator("option").allTextContents();
check(
  "the lesson picker offers the host's days PLUS today's off-schedule extra",
  dateOptions
    .slice(1)
    .every((d) => /Sat/i.test(d) || norm(d) === norm(BOOK_LABEL)),
  dateOptions.slice(1, 4).join(" | ")
);
const pickIdx = dateOptions.findIndex((d) => norm(d) === norm(BOOK_LABEL));
check(
  "today's extra lesson is among the offered dates",
  pickIdx >= 1,
  `looked for "${BOOK_LABEL}" in: ${dateOptions.slice(1, 5).join(" | ")}`
);
await selects.nth(2).selectOption({ index: pickIdx });
await tap(page.getByRole("button", { name: /Book the make-up/i }).first(), "book");
await page.waitForTimeout(3000);

text = await page.evaluate(() => document.body.innerText);
check("the booking appears under Upcoming", text.includes(KID));
check("and reads Awaiting the lesson", /Awaiting the lesson/.test(text));
await page.screenshot({ path: shot("makeups-02-booked.png"), fullPage: true });

// The duplicate refusal, verbatim from the RPC (§7.32).
await tap(page.getByRole("button", { name: /Book a make-up/i }).first(), "reopen the form");
await page.waitForTimeout(600);
await selects.nth(0).selectOption({ index: kidIdx });
await page.waitForTimeout(400);
await selects.nth(1).selectOption({ index: hostIdx });
await page.waitForTimeout(400);
await selects.nth(2).selectOption({ index: pickIdx });
await tap(page.getByRole("button", { name: /Book the make-up/i }).first(), "book the same slot again");
await page.waitForTimeout(2500);
text = await page.evaluate(() => document.body.innerText);
check(
  "booking the same slot twice surfaces the RPC's own sentence",
  /already booked into that lesson/i.test(text)
);

// ── COACH: the guest is visible where the lesson is handled ────────────────
await loginExpo(page, "coach@swimsync.test");
await gotoAuthed(page, `${EXPO}/(coach)/classes/${HOST_ID}/roster`);
await page.waitForTimeout(1500);

const roster = await page.evaluate(() => document.body.innerText);
check(
  "the host class roster shows a Make-ups coming up panel naming the guest",
  /Make-ups? coming up/.test(roster) && roster.includes(KID),
  "the guest's NAME rendering is the widened coach_serves_student() working"
);
check(
  "the guest is NOT counted as a member of the host class",
  /Students \(0\)/.test(roster),
  "the host has no enrolled students; a guest must not become one"
);
await page.screenshot({ path: shot("makeups-03-coach-roster.png"), fullPage: true });

await gotoAuthed(page, `${EXPO}/(coach)/classes/${HOST_ID}/attendance?date=${BOOK_ISO}`);
await page.waitForTimeout(1500);
const marking = await page.evaluate(() => document.body.innerText);
check(
  "the guest IS on the marking screen for the booked lesson",
  marking.includes(KID),
  "without this the make-up is unmarkable and the month never closes"
);
check("and is labelled Make-up", /Make-up/.test(marking));
await page.screenshot({ path: shot("makeups-04-coach-marking.png"), fullPage: true });

await browser.close();

// ── PARENT: a FRESH browser (loginExpo expects the login form, and an authed
// session redirects straight past it) ───────────────────────────────────────
const second = await launch();
await loginExpo(second.page, "makeupvis-parent@swimsync.test");
await second.page.waitForTimeout(1500);
const home = await second.page.evaluate(() => document.body.innerText);
check(
  "the parent's home card announces the make-up",
  /Make-up lesson booked/.test(home) && home.includes(HOST_TITLE),
  "an RLS gap here would render blank, not error"
);
check(
  "and the weekly class block still stands beside it",
  /Sunday/i.test(home),
  "a make-up is IN ADDITION to the class, not instead of it"
);
await second.page.screenshot({ path: shot("makeups-05-parent-home.png"), fullPage: true });
await second.browser.close();

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(`booked: ${BOOK_ISO} (today's off-schedule extra lesson)`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
