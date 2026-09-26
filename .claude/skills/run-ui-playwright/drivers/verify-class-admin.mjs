// verify-class-admin.mjs — the Classes-page shadow-coach actions no other driver
// presses: the roster drawer's failed shadow load (an error, never an empty
// list), the rate-less-coach warning (and its "late rate" sibling, and the
// assignment date that clears it), and End on an ongoing shadow through
// end_class_shadow.
//
// Fixture: fixtures-class-admin.sql   Teardown: fixtures-class-admin-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U7. BACKLOG item: "A verify-class-admin driver for
// the uncovered shadow-coach actions". verify-coach-roster already covers Add.
//
// Logs in as class-admin-owner@swimsync.test — the owner-admin of the fixture's
// OWN business. A shadow's end date changes pay and shadow rates are per coach;
// neither may move under the seed tenant's wages drivers (plan rule 12).
//
// WHY THESE. End must END, never DELETE: an assignment that vanishes claws back
// wages already paid for the lessons it covered, so the row COUNT is asserted
// unchanged and the stamp (effective_to = the DB's today_sg(), ended_by = this
// admin) is read from the DATABASE, before and after (plan rule 5). A failed
// shadow load that renders as "nobody shadows this class" invites the admin to
// add the coach again — refused by the unique index in a way that reads as a
// bug — so the error must reach the screen. A shadow with no shadow rate blocks
// the WHOLE business's payroll months later; the warning is the only place that
// costs one sentence instead.
//
// THE FAILED LOAD (rule 9). The drawer's class_shadow_coaches GET for THIS class
// is page.route'd → 500 {"message":"forced by driver","code":"P0001"}, method
// GET only, hit-counted, and UNROUTED before End is pressed — loadShadows after
// End hits the same URL, and a lingering route would turn the End check into an
// error-branch check (plan U7 ⚠ RISK 4).
//
// No dialogs on this page (End is a plain button). No screen here buckets by
// time of day, so no clock pin (rule 13). Every Supabase call is held to
// http://127.0.0.1:54321; anything else is ABORTED and fails the run (rule 14).
//
// RE-RUN: re-load the fixture first (it RESETS the End). A re-run on a dirty DB
// fails on its first PRECONDITION, by design (rule 5).
//
// MUTATION PROOFS (§7.25) — each made on app code, run, seen red, reverted
// (`git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean after):
//
//   | # | mutation                                                   | result | red checks |
//   |---|------------------------------------------------------------|--------|------------|
//   | 1 | classes/domain/classRows.ts:100 → `if (!shadowRateFrom) return null;` (no-rate coach draws no warning) | 17/18 | "⚠ picking a coach with a TEACHING rate but no shadow rate warns 'no shadow rate yet'" (read "(none)"; the "late" warning stayed green — only the none branch moved) |
//   | 2 | classes/domain/useClassDrawer.ts:51 → delete `setShadowError(error.message)` | 17/18 | "⚠ a failed shadow load shows the error, not an empty 'nobody shadows' list" (read "(no error line) · rows 0" — the exact state the comment there forbids) |
//
// (2026-09-26, both reverted; `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean. Each mutation's
// arrival was grepped in the served chunk `/_next/static/chunks/app/(admin)/classes/page.js` as the
// changed CODE (`if (!shadowRateFrom) return null`; the loadShadows error block without
// `setShadowError(error.message)`), and the original re-grepped after the revert.)

import { execFileSync } from "node:child_process";
import { launch, loginAdmin, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
const API = "http://127.0.0.1:54321";
for (const u of [ADMIN, EXPO]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) {
    console.error(`refusing to run against a non-local URL: ${u}`);
    process.exit(2);
  }
}

const EXPECTED_CHECKS = 18;

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

const TENANT = "d4000000-0000-0000-0000-000000000001";
const OWNER = "d4000000-0000-0000-0000-0000000000a1";
const CLASS = "d4000000-0000-0000-0000-0000000000c1";
const ONGOING = "d4000000-0000-0000-0000-0000000005a2";
const HISTORY = "d4000000-0000-0000-0000-0000000005a1";
if (sql(`SELECT count(*) FROM classes WHERE id='${CLASS}'`) !== "1") {
  throw new Error("fixture not loaded — load fixtures-class-admin.sql first");
}
// Every date from the DB (§7.225, §7.7) — never a JS clock.
const TODAY = sql(`SELECT today_sg()`);
const LATE_FROM = sql(`SELECT r.effective_from FROM coach_rates r JOIN coaches c ON c.id = r.coach_id
                        WHERE c.profile_id='d4000000-0000-0000-0000-0000000000a4' AND r.role='shadow'`);
const ONGOING_FROM = sql(`SELECT effective_from FROM class_shadow_coaches WHERE id='${ONGOING}'`);
const [HIST_FROM, HIST_TO] = sql(`SELECT effective_from||'|'||effective_to FROM class_shadow_coaches WHERE id='${HISTORY}'`).split("|");
// The drawer's display format (lib/lessonDates.formatSgDate's default), applied to DB dates.
const fmt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-SG",
  { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const flat = (s) => s.replace(/\s+/g, " ").trim();

const { browser, ctx, page } = await launch({ headless: true });
page.setDefaultTimeout(15000);
if (process.env.SHOT_DIR) console.log("shots:", process.env.SHOT_DIR);

// ── Network guard over the WHOLE run ────────────────────────────────────────
const offLocal = [];
let localApiCalls = 0;
await ctx.route(/\/(rest|auth|functions|storage)\/v1\//, (route) => {
  const origin = new URL(route.request().url()).origin;
  if (origin !== API) { offLocal.push(route.request().url()); return route.abort(); }
  localApiCalls++;
  return route.continue();
});
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// ── Page handles ────────────────────────────────────────────────────────────
const drawer = page.getByRole("dialog", { name: "ClsAdm Squad" });
const section = drawer.locator("section", { hasText: "Shadow coaches" });
const rows = section.locator("li");
const errLine = section.locator("p.bg-red-50");
const warning = section.locator("p.bg-amber-50");
const pick = section.locator("select");
const fromInput = section.locator('input[aria-label="Shadowing from"]');
const rowTexts = async () => (await rows.allInnerTexts()).map(flat);
const warnText = async () => (await warning.count()) === 0 ? "(none)" : flat(await warning.innerText());
async function openDrawer() {
  await page.locator("tr", { hasText: "ClsAdm Squad" }).getByRole("button", { name: /See students/ }).click();
  await drawer.waitFor();
}
// Wait until the section shows its assignment rows (or the error line).
async function sectionSettled(ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await rows.count()) > 0 || (await errLine.count()) > 0) return;
    await page.waitForTimeout(200);
  }
}

const shadowQ = `SELECT count(*)||'/'||count(*) FILTER (WHERE effective_to IS NULL)
                   FROM class_shadow_coaches WHERE class_id='${CLASS}'`;
const ongoingQ = `SELECT coalesce(effective_to::text,'∅')||'|'||coalesce(ended_by::text,'∅')||'|'||(ended_at IS NOT NULL)
                    FROM class_shadow_coaches WHERE id='${ONGOING}'`;

try {
  await loginAdmin(page, "class-admin-owner@swimsync.test");
  await page.goto(`${ADMIN}/classes`, { waitUntil: "networkidle" });
  await page.locator("tr", { hasText: "ClsAdm Squad" }).waitFor();

  // ══ 1. A failed shadow load is an ERROR, never "nobody shadows" ════════════
  check("PRECONDITION: two assignments on the class, one ongoing (from ≥7 days ago), nothing ended on it",
    sql(shadowQ) === "2/1" && sql(ongoingQ) === "∅|∅|false" &&
      sql(`SELECT '${ONGOING_FROM}'::date <= today_sg() - 7`) === "t",
    `${sql(shadowQ)} · ${sql(ongoingQ)} · from ${ONGOING_FROM}`);

  let hits = 0;
  const isShadowGet = (url) => {
    const u = new URL(url);
    return u.origin === API && u.pathname === "/rest/v1/class_shadow_coaches" &&
      u.searchParams.get("class_id") === `eq.${CLASS}`;
  };
  const fail500 = (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    hits++;
    return route.fulfill({ status: 500, contentType: "application/json",
      body: JSON.stringify({ message: "forced by driver", code: "P0001" }) });
  };
  await page.route(isShadowGet, fail500);
  await openDrawer();
  await sectionSettled();
  // Give a (mutated) silent failure time to render nothing at all.
  await page.waitForTimeout(800);
  const errShown = (await errLine.count()) ? flat(await errLine.innerText()) : "(no error line)";
  check("⚠ a failed shadow load shows the error, not an empty 'nobody shadows' list",
    errShown === "forced by driver" && (await rows.count()) === 0,
    `${errShown} · rows ${await rows.count()}`);
  await page.unroute(isShadowGet, fail500);
  check("the route matched exactly the one class_shadow_coaches GET", hits === 1, `hits ${hits}`);

  await drawer.getByRole("button", { name: "Close" }).click();
  await drawer.waitFor({ state: "hidden" });
  await openDrawer();
  await sectionSettled();

  // ══ 2. The list: ongoing AND ended history, both shown ═════════════════════
  const listed = await rowTexts();
  check("unrouted, the drawer lists the ongoing assignment AND the ended one (history is shown, not hidden)",
    listed.length === 2 &&
      listed[0] === `ClsAdm Shadow ${fmt(ONGOING_FROM)} – ongoing End` &&
      listed[1] === `ClsAdm Shadow ${fmt(HIST_FROM)} – ${fmt(HIST_TO)} ended` &&
      (await errLine.count()) === 0,
    listed.join(" | "));

  const offered = (await pick.locator("option").allInnerTexts()).map(flat);
  check("Add a shadow offers the two free coaches — not the ongoing shadow, not the class's own coach",
    offered.join(",") === "Add a shadow…,ClsAdm Norate,ClsAdm Late", offered.join(","));

  // ══ 3. The rate warning — keyed on the PICKED coach's shadow rate ══════════
  check("PRECONDITION: no warning with nobody picked", (await warnText()) === "(none)", await warnText());

  const TAIL = "Set one on Wages before payroll — without a rate in force the whole business's payroll run will refuse rather than pay the wrong rate.";
  await pick.selectOption({ label: "ClsAdm Norate" });
  const noneWarn = await warning.waitFor({ timeout: 3000 }).then(warnText).catch(() => "(none)");
  check("⚠ picking a coach with a TEACHING rate but no shadow rate warns 'no shadow rate yet'",
    noneWarn === `This coach has no shadow rate yet. ${TAIL}`, noneWarn);

  await pick.selectOption({ label: "ClsAdm Late" });
  await page.waitForTimeout(300);
  const lateWarn = await warnText();
  check("picking a coach whose shadow rate starts later warns 'only starts on <that date>'",
    lateWarn === `This coach's shadow rate only starts on ${fmt(LATE_FROM)}, after this assignment does. ${TAIL}`,
    lateWarn);

  await fromInput.fill(LATE_FROM);
  await page.waitForTimeout(300);
  check("…and an assignment starting ON the rate's first day clears it (a date, not a boolean)",
    (await warnText()) === "(none)", await warnText());

  await fromInput.fill("");
  await pick.selectOption({ index: 0 });
  await page.waitForTimeout(300);
  check("picking wrote nothing (still 2 assignments, 1 ongoing), and the warning clears with the pick",
    sql(shadowQ) === "2/1" && sql(ongoingQ) === "∅|∅|false" && (await warnText()) === "(none)",
    `${sql(shadowQ)} · ${sql(ongoingQ)} · ${await warnText()}`);

  // ══ 4. End — stamped, never deleted ════════════════════════════════════════
  const histQ = `SELECT effective_from||'|'||effective_to FROM class_shadow_coaches WHERE id='${HISTORY}'`;
  check("PRECONDITION (before End): 2 rows, the ongoing one unstamped, the history row as loaded",
    sql(shadowQ) === "2/1" && sql(ongoingQ) === "∅|∅|false" && sql(histQ) === `${HIST_FROM}|${HIST_TO}`,
    `${sql(shadowQ)} · ${sql(ongoingQ)} · ${sql(histQ)}`);

  const reloaded = page.waitForResponse((r) => isShadowGet(r.url()) && r.request().method() === "GET" &&
    r.status() === 200, { timeout: 10000 }).catch(() => null);
  await rows.first().getByRole("button", { name: "End" }).click();
  const ended = await dbUntil(ongoingQ, (v) => !v.startsWith("∅"));
  check("⚠ End stamps effective_to = the DB's today_sg()", ended.split("|")[0] === TODAY,
    `effective_to ${ended.split("|")[0]} · today_sg ${TODAY}`);
  check("…ended_by = this admin's profile, ended_at set", ended === `${TODAY}|${OWNER}|true`, ended);
  check("⚠ …and the row COUNT is unchanged — ended, never deleted (a DELETE claws back paid wages)",
    sql(shadowQ) === "2/0" && sql(histQ) === `${HIST_FROM}|${HIST_TO}` &&
      sql(`SELECT count(*) FROM class_shadow_coaches WHERE tenant_id='${TENANT}'`) === "2",
    `${sql(shadowQ)} · history ${sql(histQ)}`);

  const gotReload = !!(await reloaded);
  const endT = Date.now() + 8000;
  let after = await rowTexts();
  while (!after[0]?.endsWith(" ended") && Date.now() < endT) { await page.waitForTimeout(200); after = await rowTexts(); }
  check("the drawer re-reads and shows it ENDED today — no End button left, no error",
    gotReload && after.length === 2 &&
      after[0] === `ClsAdm Shadow ${fmt(ONGOING_FROM)} – ${fmt(TODAY)} ended` &&
      (await section.getByRole("button", { name: "End" }).count()) === 0 && (await errLine.count()) === 0,
    `reload ${gotReload} · ${after.join(" | ")}`);

  const offeredAfter = (await pick.locator("option").allInnerTexts()).map(flat);
  await pick.selectOption({ label: "ClsAdm Shadow" });
  await page.waitForTimeout(300);
  check("the ended coach is offered again, and (rate in force since 60 days ago) draws no warning",
    offeredAfter.includes("ClsAdm Shadow") && (await pick.inputValue()) !== "" && (await warnText()) === "(none)",
    `${offeredAfter.join(",")} · picked ${(await pick.inputValue()) !== ""} · ${await warnText()}`);

  // ══ 5. Run-wide guards ═════════════════════════════════════════════════════
  check("every Supabase call went to the local stack", offLocal.length === 0 && localApiCalls > 0,
    `local ${localApiCalls} · off-local ${offLocal.slice(0, 2).join(", ")}`);
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || ").slice(0, 200));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/class-admin-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
