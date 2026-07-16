// Attendance-window UX: how far back a coach can mark, and the parent's
// "nothing has happened yet" vs "coach is behind" empty states.
//
// Guards behaviour that unit tests can't see end-to-end:
//  1. Coach roster's primary button targets the MOST RECENT EXPECTED lesson in
//     the window (today if it's a class day, else the last class day) — not a raw
//     "today", which let a coach mark/bill a session on a non-lesson day.
//  2. Coach roster shows a "No lessons to mark yet" placeholder when nothing has
//     fallen due (brand-new class), instead of an unusable button.
//  3. Parent attendance distinguishes "No lessons have taken place yet" (child
//     just joined) from "No lessons marked yet" (a lesson passed, coach hasn't
//     marked) — the old copy wrongly implied the coach was behind in both.
//
// Setup (from repo root), assuming the machine clock is Thu 16 – Fri 17 Jul 2026:
//   supabase db reset
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-attendance-window.sql
//   cd SwimSyncApp && npx expo start --web   # :8081
//   node .claude/skills/run-ui-playwright/drivers/verify-attendance-window.mjs
//
// GOTCHA (#6): the previous stack screen stays mounted under the current one, so
// assert on strings unique to the target roster/state.
import os from "node:os";
import { launch, loginExpo, tap, dumpText } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const mobile = { viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true, timezoneId: "Asia/Singapore" };
const { browser } = await launch();

try {
  // ----------------------------- COACH -----------------------------
  const cctx = await browser.newContext(mobile);
  const page = await cctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await loginExpo(page, "coach@swimsync.test", "password123");

  await tap(page.locator('a[href="/classes"]').first(), "Classes tab");
  await page.waitForTimeout(3000);
  await tap(page.getByText("Saturday Beginners").last(), "Saturday Beginners");
  await page.waitForTimeout(3500);
  let t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/aw-coach-saturday.png`, fullPage: true });
  const btn = t.match(/Mark Attendance[^\n]*/)?.[0] ?? "(no button)";
  check("coach roster button targets a past Saturday, not raw Today",
    /Mark Attendance — Sat, \d{1,2} Jul 2026/.test(t) && !/Mark Attendance[^\n]*\(Today\)/.test(t), btn);
  check("coach roster shows the 'how far back' note",
    /You can mark lessons back to/.test(t), t.match(/You can mark lessons back to[^\n.]*/)?.[0] ?? "");

  await tap(page.locator('a[href="/classes"]').first(), "Classes tab");
  await page.waitForTimeout(2500);
  await tap(page.getByText("Sunday Newbies").last(), "Sunday Newbies");
  await page.waitForTimeout(3500);
  t = await dumpText(page);
  await page.screenshot({ path: `${SHOT}/aw-coach-sunday.png`, fullPage: true });
  check("coach roster placeholder when nothing has fallen due",
    /No lessons to mark yet/.test(t) && /first lesson hasn't taken place yet/.test(t));

  // ----------------------------- PARENT ----------------------------
  const pctx = await browser.newContext(mobile);
  const p2 = await pctx.newPage();
  p2.on("dialog", (d) => d.accept().catch(() => {}));
  await loginExpo(p2, "parent-win@swimsync.test", "password123");

  await tap(p2.locator('a[href="/attendance"]').first(), "Attendance tab");
  await p2.waitForTimeout(3500);

  await tap(p2.getByText("Ana", { exact: true }).last(), "Ana chip");
  await p2.waitForTimeout(3000);
  let pt = await dumpText(p2);
  await p2.screenshot({ path: `${SHOT}/aw-parent-ana.png`, fullPage: true });
  check("parent: a due-but-unmarked lesson reads 'No lessons marked yet'",
    /No lessons marked yet/.test(pt));

  await tap(p2.getByText("Newkid", { exact: true }).last(), "Newkid chip");
  await p2.waitForTimeout(3000);
  pt = await dumpText(p2);
  await p2.screenshot({ path: `${SHOT}/aw-parent-newkid.png`, fullPage: true });
  check("parent: a just-joined child reads 'No lessons have taken place yet'",
    /No lessons have taken place yet/.test(pt));
} catch (e) {
  console.error("DRIVER ERROR:", e);
  results.push(false);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
process.exit(failed ? 1 : 0);
