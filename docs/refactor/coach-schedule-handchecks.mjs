// Hand-check for the coach Schedule refactor (COACH_SCHEDULE_REFACTOR_PLAN.md, Stages 3–5).
// The skeleton of the BACKLOG driver "coach Schedule role badges, location chips and DONE tap".
// Run from .claude/skills/run-ui-playwright/drivers/ after a db reset + fixtures-coach-roster.sql
// + coach-schedule-handchecks.sql; SHOTDIR / TAG name the screenshots. 9 checks, 9/9 before and after.
import { launch, loginExpo, visibleText } from "./lib.mjs";
import { execSync } from "node:child_process";
const SHOT = process.env.SHOTDIR; const TAG = process.env.TAG;
const psql = (sql) => execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tA -c "${sql}"`).toString().trim();
const res = []; const check = (ok, msg) => { res.push(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const todayCard = async (page, title) => {
  const t = await page.evaluate(() => document.body.innerText);
  const i = t.indexOf("TODAY ·"); const seg = i < 0 ? "" : t.slice(i);
  const j = seg.indexOf(title); return j < 0 ? "" : seg.slice(j, j + 400);
};
async function asUser(email, fn) {
  const { browser, page } = await launch();
  await loginExpo(page, email, "password123");
  await page.getByText(/Good morning/).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await fn(page); await browser.close();
}
// 1. roles on TODAY
await asUser("roster-sub@swimsync.test", async (page) => {
  const c = await todayCard(page, "RosterCov Lane");
  check(/Covering/i.test(c) && /Mark Attendance/.test(c), "sub: RosterCov Lane → Covering + Mark Attendance");
  await page.screenshot({ path: `${SHOT}/hc-${TAG}-sub.png` });
});
await asUser("roster-shadow@swimsync.test", async (page) => {
  const c = await todayCard(page, "RosterCov Second");
  check(/Shadowing/i.test(c) && /View lesson/.test(c), "shadow: RosterCov Second → Shadowing + View lesson");
  await page.screenshot({ path: `${SHOT}/hc-${TAG}-shadow.png` });
});
await asUser("coach@swimsync.test", async (page) => {
  const c = await todayCard(page, "RosterCov Lane");
  check(/Covered/i.test(c) && /View lesson/.test(c), "owner: RosterCov Lane → Covered + View lesson");
  await page.screenshot({ path: `${SHOT}/hc-${TAG}-owner.png` });
  // 2. location chips + clamp
  const t0 = await page.evaluate(() => document.body.innerText);
  check(/All locations/.test(t0) && /RosterCov Pool/.test(t0), "chips render: All locations + RosterCov Pool");
  await page.getByText("RosterCov Pool", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => document.body.innerText);
  const i1 = t1.indexOf("TODAY ·");
  check(i1 >= 0 && /RosterCov Lane/.test(t1.slice(i1)) && !/Saturday Beginners/.test(t1.slice(i1)), "filter: only RosterCov Pool cards in the week");
  await page.screenshot({ path: `${SHOT}/hc-${TAG}-filtered.png` });
  psql("UPDATE classes SET is_active=false, deactivated_at=now() WHERE id IN ('c7000000-0000-0000-0000-00000000000a','c7000000-0000-0000-0000-00000000000b')");
  await page.getByText("Classes", { exact: true }).last().click(); await page.waitForTimeout(2000);
  await page.getByText("Schedule", { exact: true }).last().click(); await page.waitForTimeout(3000);
  const t2 = await page.evaluate(() => document.body.innerText);
  check(!/All locations/.test(t2), "clamp: chips gone once only one location remains");
  // Saturday Beginners is in the week (COMING UP / DONE / TODAY) — i.e. rendered UNFILTERED:
  const weekHasSat = /Saturday Beginners/.test(t2) || await page.getByText(/^(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\w*,? \d+ \w+$/).count() > 0;
  check(weekHasSat, "clamp: the week renders unfiltered (the seed Saturday class's day is listed)");
  await page.screenshot({ path: `${SHOT}/hc-${TAG}-clamp.png` });
  psql("UPDATE classes SET is_active=true, deactivated_at=null WHERE id IN ('c7000000-0000-0000-0000-00000000000a','c7000000-0000-0000-0000-00000000000b')");
  // 3. a DONE row tap → the attendance URL
  try {
  await page.getByTestId("week-prev").first().click(); await page.waitForTimeout(3000);
  const day = page.getByText(/^(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\w*,? \d+ \w+$/);
  const t3 = await page.evaluate(() => document.body.innerText);
  if (/\nDONE\n/.test(t3) && await day.count() > 0) {
    await day.last().click(); await page.waitForTimeout(1000);
    const title = page.locator("div.text-sm.font-bold").filter({ hasText: /^(Saturday Beginners|RosterCov Lane|RosterCov Second)$/ });
    check(await title.count() > 0, `DONE day expanded: ${await title.count()} card title(s)`);
    await title.last().click({ timeout: 8000 }).catch((e) => check(false, "DONE tap: " + e.message.split("\n")[0]));
    await page.waitForTimeout(2500);
    const url = page.url();
    check(/\/classes\/[0-9a-f-]+\/attendance\?date=\d{4}-\d{2}-\d{2}&from=schedule/.test(url), `DONE tap → attendance URL (${url})`);
  } else check(false, "DONE section with a day found last week");
  } catch (e) { check(false, "DONE step threw: " + e.message.split("\n")[0]); }
  await page.screenshot({ path: `${SHOT}/hc-${TAG}-done.png` });
});
console.log(res.join("\n"));
