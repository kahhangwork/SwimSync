// clock: pinnable
//
// THE TEMPLATE A NEW DRIVER COPIES. Not `verify-*`, so the runner never runs it;
// check-driver-clock.sh holds it to every driver rule, so it cannot drift.
//
// Copy to verify-<name>.mjs and (if it needs rows the seed lacks)
// _TEMPLATE-fixture.sql to fixtures-<name>.sql + fixtures-<name>-teardown.sql.
//
// ⚠ THE CLOCK CONTRACT (docs/plans/PIN_DRIVER_CLOCK_PLAN.md). `run-all-drivers.sh
// --now '<past ts+08>'` replays a moment across the browser, PostgREST, this
// file's SQL, the fixture and the engine. That works only if this driver reads
// "now" exclusively through lib.mjs:
//   • today / now in Node  → todaySg() / nowSg()    never new Date() / Date.now()
//   • today / now in SQL   → app_today() / app_now() never now() / CURRENT_DATE
//   • a browser            → launch()'s browser      never chromium.launch() —
//                            every context on it is pinned for you
//   • a date LABEL         → sgLabel(iso)           never toLocaleDateString (§7.302)
// A line that must read the REAL clock (elapsed timing) ends with
// `// clock-real: <why>`. Before the first commit, run it once pinned:
//   run-all-drivers.sh --only <name> --now '2026-10-01 07:59+08'
//
// Setup:
//   cd SwimSyncApp && npx expo start --web    # :8081
//   node .claude/skills/run-ui-playwright/drivers/verify-<name>.mjs

import os from "node:os";
import { launch, loginExpo, visibleText, nowSg, todaySg, addDaysIso, sql, sgLabel } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();

const results = [];
function check(label, cond, detail = "") {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

// Dates are DERIVED from the (possibly pinned) clock, never typed in: a literal
// date expires the day the marking floor passes it (§7.303).
const today = todaySg();
const weekAgo = addDaysIso(today, -7);
console.log(`clock: ${nowSg().toISOString()} → today ${today} (SGT)`);

const { browser, page } = await launch({ mobile: true });

try {
  // The ACTUAL side of a dated check reads the system under test; the EXPECTED
  // side may come from todaySg(). Never replace a clock read on the actual side
  // with a literal or nowSg() — that is a check that cannot fail (§7.338).
  const dbToday = sql("SELECT app_today()::text");
  check("the database and the driver agree on today", dbToday === today, `db ${dbToday}, driver ${today}`);

  const lessons = Number(
    sql(`SELECT count(*) FROM lesson_sessions WHERE session_date BETWEEN '${weekAgo}' AND app_today()`)
  );
  console.log(`lessons in the last week: ${lessons}`);

  await loginExpo(page, "coach@swimsync.test");
  const text = await visibleText(page);
  await page.screenshot({ path: `${SHOT}/template.png`, fullPage: true });
  // Labels come from sgLabel — en-SG, so September reads "Sept" like the app.
  check("the home screen rendered", text.length > 0, `label for today would be "${sgLabel(today)}"`);
} catch (e) {
  // §7.79 — a crash is a failed check, so it goes through the same tally.
  check(`the driver ran to completion — it crashed: ${e.message}`, false, String(e.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  // A run that asserted NOTHING is a failure, not a pass.
  process.exit(results.length > 0 && passed === results.length ? 0 : 1);
}
