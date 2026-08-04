// A parent claiming the child their coach already added — end to end, both UIs.
//
// WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT.
// It drives the real flow: parent types a child their coach already has →
// popup → "yes that's my child" → BLOCKED from re-adding → admin sees the
// badge → approves → the child appears in the parent's app WITH the lesson
// already marked. Then the other branch: "no, different child" → duplicate
// created → the admin's Students page flags the pair → merge → one row
// survives holding the attendance.
//
// THE LOAD-BEARING ASSERTIONS are the two that no unit test can reach:
//   • the popup actually OPENS. Slice 1 shipped a correct server refusal that
//     rendered through a fail-safe branch, so the modal never appeared and the
//     feature was invisible while every test passed (§8.10).
//   • the parent is genuinely BLOCKED afterwards. The block lives in the RPC,
//     but a screen that swallows the outcome would leave a parent tapping Save
//     forever.
//
// It does NOT prove masking (pgTAP does, at the source) and it does not prove
// the merge's row-preservation invariant (student_merge.test.sql does).
//
// Setup:
//   supabase db reset && docker restart supabase_kong_SwimSync
//   psql -f drivers/fixtures-parent-claim.sql
//   SwimSyncAdmin npm run dev; SwimSyncApp npx expo start --web
//
// ⚠ THE `db reset` IS NOT OPTIONAL, AND SKIPPING IT LOOKS EXACTLY LIKE A BROKEN
//   DRIVER. This run files a claim, approves it and merges a duplicate; those
//   rows are not undone by re-loading the fixture, so a second run without a
//   reset fails at check 1 with the popup never opening — character for
//   character the same output as a genuinely stale driver. Cost a diagnostic
//   round on 2026-08-04, immediately after fixing a real staleness bug in this
//   same file, which is the worst possible moment to be handed a false positive.
//   If you see 0/5 here, reset FIRST and re-run before believing anything.
import os from "node:os";
import path from "node:path";
import { launch, loginAdmin, loginExpo, tap, ADMIN, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (l, p, d = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
};

const PARENT = "claimparent@swimsync.test";

// ══ PARENT: add the child the coach already has ═══════════════════════════
const { browser, page } = await launch({ mobile: true });
await loginExpo(page, PARENT);

// In-app navigation, NOT a deep link: expo-router bounces a direct goto of a
// protected route straight back to /home, so the form never mounts and the
// failure reads as "the name field does not exist".
await tap(page.getByText("Add Child").first(), "open Add Child");
await page.waitForTimeout(4000);

await page.getByPlaceholder("Emma Tan").fill("Ethan");
await page.getByPlaceholder("YYYY-MM-DD").fill("2019-01-01");
await tap(page.getByText("Save Child Profile").last(), "save (first attempt)");

// "Save Child Profile" no longer reaches the server. `handleSave()` opens an
// "Is this right?" review modal first — added 2026-07-26 01:59, FIFTY-EIGHT
// MINUTES after this driver was written (0cf8036 01:01, bad1294 01:59), which
// is how it came to fail its very first check for months without anyone
// noticing. Confirming here is what actually calls add_child_or_claim('check').
await tap(page.getByText(/Yes, add this child/i).last(), "confirm the details (first attempt)");
await page.waitForTimeout(3500);

let text = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: shot("claim-01-popup.png"), fullPage: true });

// ⚠ THE ONE THAT CATCHES A DEAD FEATURE. A server that answers perfectly is
// worth nothing if the screen never renders the answer.
check(
  "the 'is this your child?' popup OPENS",
  /Is this your child\?/i.test(text),
  "a correct refusal rendered through a fail-safe branch is how slice 1 shipped an invisible modal"
);

check(
  "the candidate is MASKED — the family name is not shown",
  /Ethan T\./.test(text) && !/Wei Ming/.test(text),
  "masking happens in SQL, so no full name crosses the wire at all"
);

check(
  "the card names the lesson the parent can actually check",
  /Saturday Beginners/i.test(text),
  "the detail a real parent recognises and a guesser cannot"
);

check(
  "the heading asks a QUESTION rather than announcing a finding",
  !/we found your child/i.test(text) && /may have already added/i.test(text)
);

check(
  "all three answers are offered",
  /that.s my child/i.test(text) && /not sure/i.test(text) && /add .* as a new child/i.test(text)
);

// Nothing is pre-selected, so Confirm must be inert until a candidate is picked.
await tap(page.getByText(/that.s my child/i).last(), "confirm BEFORE choosing");
await page.waitForTimeout(1500);
text = await page.evaluate(() => document.body.innerText);
check(
  "Confirm does nothing until a candidate is chosen",
  /Is this your child\?/i.test(text),
  "nothing is pre-selected — a single candidate must not auto-advance"
);

await tap(page.getByText(/Ethan T\./).last(), "choose the candidate");
await page.waitForTimeout(600);
await tap(page.getByText(/that.s my child/i).last(), "confirm");
await page.waitForTimeout(4000);

text = await page.evaluate(() => document.body.innerText);
check(
  "the child is NOT added straight away — it goes to the coach",
  /Waiting for your coach/i.test(text) || /coach to confirm/i.test(text),
  "the admin decides every link; the parent's certainty cannot price the risk"
);
await page.screenshot({ path: shot("claim-02-pending.png"), fullPage: true });

// ⚠ THE BLOCK. Re-adding the same child must be refused while it is pending,
// or tapping Save again is a way straight round the popup.
// In-app navigation, NOT a deep link: expo-router bounces a direct goto of a
// protected route straight back to /home, so the form never mounts and the
// failure reads as "the name field does not exist".
await tap(page.getByText("Add Child").first(), "open Add Child");
await page.waitForTimeout(4000);
await page.getByPlaceholder("Emma Tan").fill("Ethan");
await page.getByPlaceholder("YYYY-MM-DD").fill("2019-01-01");
await tap(page.getByText("Save Child Profile").last(), "save (second attempt)");
await tap(page.getByText(/Yes, add this child/i).last(), "confirm the details (second attempt)");
await page.waitForTimeout(3500);
text = await page.evaluate(() => document.body.innerText);
// Asserted on STATE, not on the toast: the toast fades, and a driver that
// races it reports a failure that is not one. What must be true is that the
// second attempt created nothing.
check(
  "⚠ the parent is BLOCKED from re-adding that child while it is pending",
  /Waiting for your coach/i.test(text) && /No children added yet/i.test(text),
  "the second Save created nothing — without this the popup is merely advisory"
);

// ══ ADMIN: the badge, then approve ════════════════════════════════════════
const admin = await launch();
await loginAdmin(admin.page, "coach@swimsync.test");
await admin.page.goto(`${ADMIN}/claims`);
await admin.page.waitForTimeout(2500);

text = await admin.page.evaluate(() => document.body.innerText);
check("the request reaches the admin queue", /Ethan Tan Wei Ming/.test(text));
check(
  "the admin sees the FULL name and the parent's own words side by side",
  /The parent says/i.test(text) && /On your roster/i.test(text) && /Ethan Tan Wei Ming/.test(text),
  "the admin is entitled to their own business's data; the parent is not, yet"
);
check(
  "the lesson count is shown — what makes a wrong approval expensive",
  /1 lesson recorded/i.test(text)
);
check(
  "the sidebar badge counts the waiting request",
  /Parent Requests/i.test(text),
  "the badge is the whole notification — nothing emails the admin"
);
await admin.page.screenshot({ path: shot("claim-03-queue.png"), fullPage: true });

await tap(admin.page.getByRole("button", { name: /^Approve$/ }).first(), "approve");
await admin.page.waitForTimeout(2000);
text = await admin.page.evaluate(() => document.body.innerText);
check(
  "approving is a two-step confirm naming BOTH parties",
  /Ethan Tan Wei Ming/.test(text) && /Claim Parent/.test(text) && /link them/i.test(text)
);
await tap(admin.page.getByRole("button", { name: /Yes, link them/i }).first(), "confirm link");
await admin.page.waitForTimeout(3000);

// ⚠ THE WAY BACK. Nothing else in the product can unlink a parent from a
// child, so this button existing is the difference between a recoverable
// mistake and an SQL session against production.
await tap(admin.page.getByRole("button", { name: /Show decided requests/i }).first(), "show decided");
await admin.page.waitForTimeout(800);
text = await admin.page.evaluate(() => document.body.innerText);
check(
  "an approved link offers 'Undo this link'",
  /Undo this link/i.test(text),
  "parent_students_delete covers the parent and the platform admin — never this admin"
);

// ══ PARENT: the child arrives, with the lesson already marked ═════════════
await page.goto(`${EXPO}/home`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
text = await page.evaluate(() => document.body.innerText);
check(
  "the claimed child now appears in the parent's app",
  /Ethan Tan Wei Ming/.test(text),
  "same student_id throughout — nothing was transferred"
);
check(
  "and the waiting card is gone",
  !/Waiting for your coach/i.test(text)
);
await page.screenshot({ path: shot("claim-04-arrived.png"), fullPage: true });

// ══ THE OTHER BRANCH: "no, different child" → duplicate → merge ═══════════
// In-app navigation, NOT a deep link: expo-router bounces a direct goto of a
// protected route straight back to /home, so the form never mounts and the
// failure reads as "the name field does not exist".
await tap(page.getByText("Add Child").first(), "open Add Child");
await page.waitForTimeout(4000);
await page.getByPlaceholder("Emma Tan").fill("Ethan Tan");
// ⚠ THE SAME date of birth. A different one makes these two a NAMESAKE, not a
// duplicate, and the detector correctly ignores it — which is what the first
// draft of this driver got wrong, asserting a pair would be flagged after
// deliberately making it un-flaggable.
await page.getByPlaceholder("YYYY-MM-DD").fill("2019-01-01");
await tap(page.getByText("Save Child Profile").last(), "save (a genuinely different child)");
await tap(page.getByText(/Yes, add this child/i).last(), "confirm the details (different child)");
await page.waitForTimeout(3500);
text = await page.evaluate(() => document.body.innerText);

// The claimed child is no longer a candidate, so this may create directly.
if (/Is this your child\?/i.test(text)) {
  await tap(page.getByText(/add .* as a new child/i).last(), "no, a different child");
  await page.waitForTimeout(3500);
}
text = await page.evaluate(() => document.body.innerText);
check(
  "answering 'no' creates the child as entered",
  /Ethan Tan/.test(text),
  "the parent may be right — and the admin gets told about the pair either way"
);

await admin.page.goto(`${ADMIN}/students`);
await admin.page.waitForTimeout(2500);
text = await admin.page.evaluate(() => document.body.innerText);
check(
  "the admin's Students page FLAGS the two records as possibly the same child",
  /may be the same child/i.test(text),
  "nothing detected this before — the remedy was SQL"
);
await admin.page.screenshot({ path: shot("claim-05-duplicate.png"), fullPage: true });

await tap(admin.page.getByRole("button", { name: /Review & merge/i }).first(), "open merge");
await admin.page.waitForTimeout(800);
text = await admin.page.evaluate(() => document.body.innerText);
check(
  "the merge dialog names which record is KEPT and which is DELETED",
  /Kept/i.test(text) && /Deleted/i.test(text)
);
check(
  "and it keeps the record holding the lesson",
  /1 lesson recorded/i.test(text),
  "merge_students refuses the other direction outright"
);

await tap(admin.page.getByRole("button", { name: /Merge them/i }).first(), "merge");
await admin.page.waitForTimeout(3500);
text = await admin.page.evaluate(() => document.body.innerText);
check(
  "after merging, the duplicate warning is gone",
  !/may be the same child/i.test(text)
);
await admin.page.screenshot({ path: shot("claim-06-merged.png"), fullPage: true });

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
await browser.close();
await admin.browser.close();
process.exit(passed === results.length ? 0 : 1);
