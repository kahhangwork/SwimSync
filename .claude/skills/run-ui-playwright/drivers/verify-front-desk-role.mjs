// verify-front-desk-role.mjs — the Front-desk hire's day, done AS the hire.
//
// Fixture: fixtures-front-desk-role.sql   Teardown: fixtures-front-desk-role-teardown.sql
// Plan: docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md, Lane 2 (§2.2). BACKLOG: "A co-admin
// without pricing access may see NO teaching coach anywhere".
//
// Logs in as frontdesk@swimsync.test — a pure co-admin of the seed tenant on its STANDARD
// Front desk role (Operations = Edit; Profile, Admins, Pricing, Billing, Packages, Wages,
// Accounting = None). The fixture RAISEs unless the role is exactly that, so a green run
// here is a statement about THAT role.
//
//   1. the sidebar shows the operations pages and no money page; a typed /invoices gets
//      the role refusal, not a half page
//   2. the Calendar shows yesterday's lesson WITH its coach's name
//   3. the lesson page says "Teaching: <coach>" and the prev/next strip groups the lesson
//      under that coach, not "Unassigned"
//   4. mark both children on the lesson page → saved, and read back after a reload
//   5. book a make-up into another class → it is on that lesson's roster as a guest
//      (make-ups touch packages; Front desk has Packages = None)
//   6. Students → Actions → + Add class, today's start → enrolled
//
// WEEKDAY- AND HOUR-INDEPENDENT. Class 1 runs on yesterday's weekday (SGT), class 2 on
// today's; every date is read from the DB, never JS local time (§7.7).
//
// Check 6 touches ONLY the class picker and the Add class button, by role and name, and
// leaves any other field (lane 1's "Starts on") at its default — no selector assumes the
// modal holds exactly one input (plan RISK 11).
//
// RE-RUN: teardown, then fixture. A dirty DB fails the PRECONDITION check, by design.
//
// FIRST RUN (2026-10-05, before the fix): 8/11 — checks 2, 3a, 3b RED. The persona reads 0
// class_rates rows (policy class_rates_admin_select needs pricing:view), so every "who taught"
// reader resolves no paid coach. Fix: migration 20261005000200_who_taught_for_operations.
//
// After the fix (main @ ccc0e4a): 11/11.
//
// MUTATION PROOFS (§7.25, plan §2.2) — the persona moved by SQL onto a temporary role after
// the fixture loads, run, teardown, role dropped (2026-10-05):
//
//   | # | persona's role                                 | result | red checks                              |
//   |---|------------------------------------------------|--------|-----------------------------------------|
//   | 1 | Operations = None, every other area None       | 2/11   | PRECONDITION, 1a (no ops page), 2, 3a, 3b, 4a, 4b, 5, 6 — each with its own detail (1b stays green: still refused) |
//   | 2 | Operations = Edit, Billing = View, rest None   | 8/11   | PRECONDITION, 1a (/invoices + /credit-notes + Billing group shown), 1b (/invoices renders) — 2–6 stay green |

import { execFileSync } from "node:child_process";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

if (!["localhost", "127.0.0.1"].includes(new URL(ADMIN).hostname)) {
  console.error(`refusing to run against a non-local URL: ${ADMIN}`);
  process.exit(2);
}

const EXPECTED_CHECKS = 11;

const DB = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split("\n").find((n) => n.startsWith("supabase_db_"));
if (!DB) throw new Error("no running supabase_db_* container — `supabase start` first");
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-Atc", q], { encoding: "utf8" }).trim();
async function dbUntil(q, ok, ms = 10000) {
  const end = Date.now() + ms;
  let v = sql(q);
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    v = sql(q);
  }
  return v;
}

const CLASS1 = "f0de0000-0000-0000-0000-000000000001"; // FD Monday Squad — yesterday's weekday
const CLASS2 = "f0de0000-0000-0000-0000-000000000002"; // FD Guest Lane — today's weekday
const ALBA = "f0de0000-0000-0000-0000-00000000a001";
const BRUNO = "f0de0000-0000-0000-0000-00000000a002";
const CARA = "f0de0000-0000-0000-0000-00000000a003";
const COACH = "FD Coach Wen";

const [TODAY, LESSON, NEXT] = sql(
  `SELECT t||'|'||(t-1)||'|'||(t+7) FROM (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS t) s`
).split("|");
console.log(`today ${TODAY}, marked lesson ${LESSON}, make-up lesson ${NEXT}`);

const OPS_PAGES = ["/calendar", "/lessons", "/students", "/classes", "/makeups", "/trials", "/unassigned"];
// Admins/Roles are the `admins` area — None on Front desk, like every money area.
const MONEY_PAGES = ["/invoices", "/credit-notes", "/packages", "/referrals", "/wages", "/accounting", "/admins", "/roles"];

const results = [];
const check = async (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass && process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/front-desk-fail-${results.length}.png`, fullPage: true })
      .catch(() => {});
  }
};
const modal = (page) => page.locator("div.fixed.inset-0.z-50").last();
const row = (page, sid) => page.locator(`[data-testid="roster-row"][data-student="${sid}"]`);
const pressed = async (page, sid, status) =>
  (await row(page, sid).locator(`[data-status="${status}"]`).getAttribute("aria-pressed", { timeout: 5000 })
    .catch(() => null)) === "true";
async function openLesson(page, classId, date) {
  await page.goto(`${ADMIN}/lessons/${classId}/${date}`, { waitUntil: "networkidle" });
  await page.getByTestId("save-attendance").waitFor({ timeout: 15000 }).catch(() => {});
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);
// Run one section's UI actions; a failure becomes that section's FAIL detail, not an abort,
// so a refused role still reports every check it breaks (the §2.2 red-proofs rely on it).
const act = (fn) => fn().then(() => "", (e) => `action failed: ${String(e).split("\n")[0].slice(0, 120)}`);

const { browser, page } = await launch({ headless: true });
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
if (process.env.SHOT_DIR) console.log("shots:", process.env.SHOT_DIR);

try {
  // ── 0. The fixture is as loaded ───────────────────────────────────────────
  const marksQ = `SELECT coalesce(string_agg(a.student_id||':'||a.status, ',' ORDER BY a.student_id), '')
                    FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
                   WHERE ls.class_id='${CLASS1}' AND ls.session_date='${LESSON}'`;
  const makeupQ = `SELECT coalesce(string_agg(class_id||'/'||home_class_id||'/'||session_date, ','), '')
                     FROM makeup_bookings WHERE student_id='${ALBA}' AND cancelled_at IS NULL`;
  const caraQ = `SELECT coalesce(string_agg(class_id||'/'||is_active||'/'||((enrolled_at AT TIME ZONE 'Asia/Singapore')::date), ','), '')
                   FROM student_class_enrolments WHERE student_id='${CARA}'`;
  const role = sql(`SELECT r.standard_key FROM profiles p JOIN tenant_roles r ON r.id = p.admin_role_id
                     WHERE p.email='frontdesk@swimsync.test'`);
  await check("PRECONDITION: the persona is on Front desk; no marks, no make-up, Cara in no class",
    role === "front_desk" && sql(marksQ) === "" && sql(makeupQ) === "" && sql(caraQ) === "",
    `role ${role || "(none)"}, marks ${sql(marksQ) || "-"}, makeup ${sql(makeupQ) || "-"}, cara ${sql(caraQ) || "-"}`);

  await loginAdmin(page, "frontdesk@swimsync.test");

  // ── 1. The sidebar, and a typed money URL ─────────────────────────────────
  await page.goto(`${ADMIN}/calendar?view=day&date=${LESSON}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  // A collapsed group renders no links, so open every group before reading hrefs.
  // An EMPTY group is dropped (groupedNavFor), so Front desk has no Billing header at all.
  const closed = page.locator('[data-testid^="navgroup-"][aria-expanded="false"]');
  for (let i = await closed.count(); i > 0; i--) await closed.first().click();
  const hrefs = await page.locator("aside a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const missingOps = OPS_PAGES.filter((p) => !hrefs.includes(p));
  const shownMoney = MONEY_PAGES.filter((p) => hrefs.includes(p));
  const billingGroup = await page.getByTestId("navgroup-billing").count();
  await check("1a. the sidebar (every group open) shows the operations pages, NO money page, no Billing group",
    hrefs.length > 0 && missingOps.length === 0 && shownMoney.length === 0 && billingGroup === 0,
    `missing ops: ${missingOps.join(",") || "-"}; money shown: ${shownMoney.join(",") || "-"}; billing group ${billingGroup}`);

  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const inv = await bodyText(page);
  await check("1b. a typed /invoices gets the role refusal (naming Billing), not a half page",
    inv.includes("Your role doesn") && inv.includes("Billing") && !/INV-\d{4}-/.test(inv),
    inv.replace(/\s+/g, " ").slice(0, 200));

  // ── 2. Calendar: the lesson WITH its coach's name ─────────────────────────
  await page.goto(`${ADMIN}/calendar?view=day&date=${LESSON}`, { waitUntil: "networkidle" });
  const card = page.getByTestId("lesson-card").filter({ hasText: "FD Monday Squad" }).first();
  const cardText = await card.innerText({ timeout: 15000 }).catch(() => "(no card)");
  await check(`2. the Calendar shows FD Monday Squad on ${LESSON} taught by ${COACH}`,
    cardText.includes(COACH), cardText.replace(/\s+/g, " ").slice(0, 120));

  // ── 3. Lesson page: Teaching + the prev/next coach strip ──────────────────
  await openLesson(page, CLASS1, LESSON);
  const lessonBody = await bodyText(page);
  const teaching = (lessonBody.match(/Teaching:\s*([^\n]*)/) ?? [])[1] ?? "(no Teaching line)";
  await check(`3a. the lesson page says "Teaching: ${COACH}"`, teaching.trim().startsWith(COACH), teaching);
  const strip = await page.getByTestId("nav-coach-counter").innerText({ timeout: 10000 }).catch(() => "(no strip)");
  await check(`3b. the prev/next strip groups the lesson under ${COACH}, not Unassigned`,
    strip.startsWith(COACH) && !strip.includes("Unassigned"), strip);

  // ── 4. Mark both children; saved; read back ───────────────────────────────
  const err4 = await act(async () => {
    await row(page, ALBA).locator('[data-status="present"]').click({ timeout: 8000 });
    await row(page, BRUNO).locator('[data-status="absent"]').click({ timeout: 8000 });
    await page.getByTestId("save-attendance").click({ timeout: 8000 });
  });
  const saveMsg = err4 || await page.getByTestId("save-message").innerText({ timeout: 15000 }).catch(() => "(no message)");
  const marks = err4 ? sql(marksQ) : await dbUntil(marksQ, (v) => v.split(",").length === 2);
  await check("4a. Save reports two marks and the DB holds Alba present, Bruno absent",
    /Saved 2 marks/.test(saveMsg) && marks === `${ALBA}:present,${BRUNO}:absent`, `${saveMsg} · ${marks || "(none)"}`);
  await openLesson(page, CLASS1, LESSON);
  await check("4b. …and after a reload the page reads the marks back",
    (await pressed(page, ALBA, "present")) && (await pressed(page, BRUNO, "absent")));

  // ── 5. A make-up into class 2 (Packages = None) ───────────────────────────
  await openLesson(page, CLASS2, NEXT);
  const err5 = await act(async () => {
    await page.getByRole("button", { name: "Book a make-up into this lesson" }).click({ timeout: 8000 });
    await modal(page).getByLabel("Child", { exact: true }).selectOption(ALBA, { timeout: 8000 });
    await page.getByTestId("book-guest").click({ timeout: 8000 });
  });
  const booked = err5 ? sql(makeupQ) : await dbUntil(makeupQ, (v) => v !== "");
  await row(page, ALBA).waitFor({ timeout: 10000 }).catch(() => {});
  const mkRow = await row(page, ALBA).innerText({ timeout: 3000 }).catch(() => "(no row)");
  await check("5. a make-up for Alba lands in FD Guest Lane (home FD Monday Squad) and is on its roster as a guest",
    booked === `${CLASS2}/${CLASS1}/${NEXT}` && /Make-up/i.test(mkRow),
    `${err5 ? `${err5} · ` : ""}${booked || "(no booking)"} · ${mkRow.replace(/\s+/g, " ").slice(0, 60)}`);

  // ── 6. Students → add Cara to a class, today's start ──────────────────────
  const err6 = await act(async () => {
    await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
    const caraRow = page.locator("tr", { hasText: "FD Cara" }).first();
    await caraRow.getByRole("button", { name: /^Actions$/ }).click({ timeout: 8000 });
    await page.getByRole("button", { name: "+ Add class" }).click({ timeout: 8000 });
    const addModal = modal(page).filter({ hasText: "Add a class for FD Cara" });
    await addModal.getByRole("combobox", { name: /^Class/ }).selectOption({ label: "FD Monday Squad" }, { timeout: 8000 });
    await addModal.getByRole("button", { name: "Add class", exact: true }).click({ timeout: 8000 });
  });
  const cara = err6 ? sql(caraQ) : await dbUntil(caraQ, (v) => v !== "");
  await check("6. Add class enrols Cara in FD Monday Squad, active, starting today",
    cara === `${CLASS1}/true/${TODAY}`, err6 || cara || "(no enrolment)");

  await check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || ").slice(0, 200));
} catch (err) {
  await check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/front-desk-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
