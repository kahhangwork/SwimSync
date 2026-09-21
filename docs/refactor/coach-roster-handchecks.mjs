// Coach roster hand-checks — the two actions no driver presses
// (docs/refactor/COACH_ROSTER_REFACTOR_PLAN.md §6 Stage 4): Remove (cancel AND
// accept, proved by a DB read) and the level curriculum's Hide branch.
//
// Setup (mutates the shared local DB — never beside a running sibling):
//   supabase db reset && docker restart <supabase_kong_…>
//   psql < .claude/skills/run-ui-playwright/drivers/fixtures-student-identity.sql
//   psql < docs/refactor/coach-roster-handchecks.sql
// Run (imports the drivers' lib.mjs, so it runs from the drivers dir):
//   cp docs/refactor/coach-roster-handchecks.mjs .claude/skills/run-ui-playwright/drivers/zz-hc.mjs
//   SHOT=/tmp node .claude/skills/run-ui-playwright/drivers/zz-hc.mjs <Saturday Beginners class id>
//   (then delete zz-hc.mjs)
// Then read the DB: Noah Lim's Saturday Beginners enrolment is closed
// (is_active false, unenrolled_at set), his Sunday Handcheck one is untouched,
// and students.is_active is still true.
//
// Hand-check (roster Stage 4). Taps are DOM clicks on the exact element, not
// force-clicks: the Schedule screen stays mounted under a deep-linked roster
// (§7.10) and a force-click at the element's coordinates can land on a card
// beneath it — which is what the first attempt did.
import { launch, loginExpo, gotoAuthed, EXPO } from "./lib.mjs";
const SHOT = process.env.SHOT, CLASS = process.argv[2];
const { browser, page } = await launch({ mobile: true });
let pass = 0, fail = 0;
const check = (ok, msg, extra = "") => { ok ? pass++ : fail++; console.log(ok ? "PASS" : "FAIL", msg, ok ? "" : extra); };
const text = () => page.evaluate(() => document.body.innerText);
const click = async (loc) => { await loc.first().waitFor({ state: "visible", timeout: 12000 }); await loc.first().evaluate((e) => e.click()); };
try {
  await loginExpo(page, "coach@swimsync.test");
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${CLASS}/roster`);
  await page.waitForTimeout(3500);
  let t = await text();
  await page.screenshot({ path: `${SHOT}/hc-1-roster.png`, fullPage: true });
  check(/Students \(4\)/.test(t), "roster lists 4 students", t.slice(0, 300));
  check(/What Toddler 1 covers/.test(t), "collapsed: 'What Toddler 1 covers'");
  check(!/Blow bubbles/.test(t), "collapsed: no skills shown");
  await click(page.getByText("What Toddler 1 covers"));
  await page.waitForTimeout(1200);
  t = await text();
  check(/Hide Toddler 1/.test(t), "expanded: label reads 'Hide Toddler 1'", t.match(/(What|Hide) Toddler.{0,40}/)?.[0]);
  check(/Water confidence/.test(t), "expanded: level note shown");
  check(/1\s*Blow bubbles[\s\S]*2\s*Float/.test(t), "expanded: skills in sort_order (1 Blow bubbles, 2 Float)");
  await page.screenshot({ path: `${SHOT}/hc-2-expanded.png`, fullPage: true });
  await click(page.getByText(/Hide\s+Toddler 1/));
  await page.waitForTimeout(1200);
  t = await text();
  check(/What Toddler 1 covers/.test(t) && !/Blow bubbles/.test(t), "Hide collapses it again");

  page.removeAllListeners("dialog");
  let dialogMsg = "";
  page.once("dialog", (d) => { dialogMsg = d.message(); d.dismiss().catch(() => {}); });
  const noahRemove = page.getByText("Noah Lim", { exact: true }).locator("xpath=ancestor::div[.//div[normalize-space()='Remove']][1]").getByText("Remove", { exact: true });
  await click(noahRemove);
  await page.waitForTimeout(1500);
  check(/^Noah Lim will be removed from THIS class/.test(dialogMsg), "confirm dialog names the child and THIS class", dialogMsg);
  t = await text();
  check(/Students \(4\)/.test(t), "cancel: still 4 students");

  page.once("dialog", (d) => d.accept().catch(() => {}));
  await click(noahRemove);
  // The toast lives 3000ms (components/Toast.tsx) — watch for it, don't sleep past it.
  const toastSeen = await page.getByText("Noah Lim removed from this class.").first()
    .waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false);
  await page.screenshot({ path: `${SHOT}/hc-3-toast.png`, fullPage: true });
  check(toastSeen, "success toast shown");
  await page.waitForTimeout(3500);
  t = await text();
  await page.screenshot({ path: `${SHOT}/hc-4-removed.png`, fullPage: true });
  check(/Students \(3\)/.test(t), "list shrinks to 3 (reload ran)");
  check(!/Noah Lim/.test(t.replace(/Noah Lim removed from this class\./, "")), "Noah no longer listed");
} catch (e) { fail++; console.log("FAIL threw", e.message); }
console.log(`hand-check ${pass}/${pass + fail}`);
await browser.close();
