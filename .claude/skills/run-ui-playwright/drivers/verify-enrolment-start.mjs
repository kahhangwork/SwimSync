// clock: pinnable
// verify-enrolment-start.mjs — "Starts on" on add-to-class, and "Change start date"
// on the class roster (Wave 4; migration 20261005000100; plan
// docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md §1.5).
//
// WHY. On 04 Oct 2026 a child swam the day BEFORE the admin assigned them; the lesson
// had no roster to mark and the only fix was SQL on production (DEPLOYMENT #62). This
// drives the fix end to end, as the admin:
//   1. Students → Actions → + Add class, Starts on = D1 (7 days ago) → the enrolment
//      starts on D1 (12:00 SGT) and is audited.
//   2. The D1 lesson page lists the child → mark present.
//   3. Classes → See students → Change: moving the start to TODAY (past the D1 mark)
//      is refused with the database's sentence, and the start does not move.
//   4. Change to D2 (one week EARLIER) → saved; the roster's Joined date moves.
//   5. Mark D2 → the class is left with NO unmarked lesson (RISK 12, §7.103).
//
// Setup: supabase start; admin on :3000 (or ADMIN_URL); fixture fixtures-enrolment-start.sql.
// RE-RUN: teardown, then fixture. A dirty DB fails the PRECONDITION check, by design.
// Persona: coach@swimsync.test — the seed tenant's OWNER (superadmin@ is the platform admin).
//
// PROVEN RED (§7.25): against main BEFORE this branch (no Starts on field) check 1 fails —
// recorded in the commit body.

import { execFileSync } from "node:child_process";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

if (!["localhost", "127.0.0.1"].includes(new URL(ADMIN).hostname)) {
  console.error(`refusing to run against a non-local URL: ${ADMIN}`);
  process.exit(2);
}

const EXPECTED_CHECKS = 9;
const DB = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split("\n").find((n) => n.startsWith("supabase_db_"));
if (!DB) throw new Error("no running supabase_db_* container — `supabase start` first");
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-Atc", q], { encoding: "utf8" }).trim();
async function dbUntil(q, ok, ms = 10000) {
  const end = Date.now() + ms; // clock-real: a poll deadline (elapsed time, not a date)
  let v = sql(q);
  while (!ok(v) && Date.now() < end) { // clock-real: a poll deadline (elapsed time, not a date)
    await new Promise((r) => setTimeout(r, 300));
    v = sql(q);
  }
  return v;
}

const CLASS = "e5e50000-0000-0000-0000-000000000001";
const DANA = "e5e50000-0000-0000-0000-00000000d001";
const [TODAY, D1, D2] = sql(
  `SELECT t||'|'||(t-7)||'|'||(t-14) FROM (SELECT app_today() AS t) s`
).split("|");
console.log(`today ${TODAY}, D1 ${D1}, D2 ${D2}`);

const startQ = `SELECT coalesce((SELECT (enrolled_at AT TIME ZONE 'Asia/Singapore')::date||'/'||(enrolled_at AT TIME ZONE 'UTC')::date
                  FROM student_class_enrolments WHERE student_id='${DANA}' AND class_id='${CLASS}' AND is_active), '-')`;
const markQ = (d) => `SELECT coalesce((SELECT a.status::text FROM attendance a JOIN lesson_sessions ls ON ls.id=a.lesson_session_id
                  WHERE ls.class_id='${CLASS}' AND ls.session_date='${d}' AND a.student_id='${DANA}'), '-')`;

const results = [];
let page;
const check = async (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass && process.env.SHOT_DIR && page) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/enrolment-start-fail-${results.length}.png`, fullPage: true })
      .catch(() => {});
  }
};
const modal = (p) => p.locator("div.fixed.inset-0.z-50").last();
const act = (fn) => fn().then(() => "", (e) => `action failed: ${String(e).split("\n")[0].slice(0, 140)}`);
// The second press (RISK 1) appears only for a start in an earlier, UNBILLED month —
// whether that applies depends on the seed tenant's billing state, so press again iff asked.
async function pressMaybeTwice(m, name) {
  await m.getByRole("button", { name, exact: true }).click({ timeout: 8000 });
  await page.waitForTimeout(600);
  if (await m.getByText(/again to confirm/i).isVisible().catch(() => false)) {
    await m.getByRole("button", { name, exact: true }).click({ timeout: 8000 });
  }
}
async function mark(date) {
  await page.goto(`${ADMIN}/lessons/${CLASS}/${date}`, { waitUntil: "networkidle" });
  const row = page.locator(`[data-testid="roster-row"][data-student="${DANA}"]`);
  await row.waitFor({ timeout: 15000 });
  await row.locator('[data-status="present"]').click();
  await page.getByTestId("save-attendance").click();
}

const { browser, page: pg } = await launch({ headless: true });
page = pg;
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
  const pre = sql(`SELECT (SELECT count(*) FROM classes WHERE id='${CLASS}')||'/'||
                          (SELECT count(*) FROM student_class_enrolments WHERE student_id='${DANA}')`);
  await check("PRECONDITION: the fixture class exists and ES Dana is in no class", pre === "1/0", pre);

  await loginAdmin(page, "coach@swimsync.test");

  // ── 1. Add class with a past start ───────────────────────────────────────
  const e1 = await act(async () => {
    await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
    const r = page.locator("tr", { hasText: "ES Dana" }).first();
    await r.getByRole("button", { name: /^Actions$/ }).click();
    await page.getByRole("button", { name: "+ Add class" }).click({ timeout: 8000 });
    const m = modal(page);
    await m.getByRole("combobox", { name: /^Class/ }).selectOption({ label: "ES Squad" });
    await m.getByLabel("Starts on").fill(D1);
    await pressMaybeTwice(m, "Add class");
  });
  const s1 = await dbUntil(startQ, (v) => v !== "-");
  await check("1. Add class with Starts on = D1 → the enrolment starts on D1, SGT and UTC alike",
    s1 === `${D1}/${D1}`, e1 || s1);
  const a1 = sql(`SELECT count(*) FROM audit_log WHERE entity_id='${DANA}' AND action='enrolment_added'`);
  await check("1b. …and it is audited (enrolment_added)", a1 === "1", a1);

  // ── 2. The D1 lesson now lists her ───────────────────────────────────────
  const e2 = await act(() => mark(D1));
  const m1 = await dbUntil(markQ(D1), (v) => v !== "-");
  await check("2. the D1 lesson page lists ES Dana and her mark saves", m1 === "present", e2 || m1);

  // ── 3. Change to today — past the D1 mark — is refused ───────────────────
  let refusal = "";
  const e3 = await act(async () => {
    await page.goto(`${ADMIN}/classes`, { waitUntil: "networkidle" });
    await page.locator("tr", { hasText: "ES Squad" }).first().getByRole("button", { name: "See students" }).click();
    await page.getByRole("button", { name: "Change start date for ES Dana" }).click({ timeout: 8000 });
    const m = modal(page);
    await m.getByLabel("New start date").fill(TODAY);
    await m.getByRole("button", { name: "Save", exact: true }).click();
    refusal = await m.getByText(/already has a mark/i).innerText({ timeout: 8000 });
  });
  await check("3. moving the start past the D1 mark is refused with the database's sentence",
    /already has a mark/i.test(refusal), e3 || refusal);
  const s3 = sql(startQ);
  await check("3b. …and the start did not move", s3 === `${D1}/${D1}`, s3);

  // ── 4. Change one week EARLIER ───────────────────────────────────────────
  const e4 = await act(async () => {
    const m = modal(page);
    await m.getByLabel("New start date").fill(D2);
    await pressMaybeTwice(m, "Save");
  });
  const s4 = await dbUntil(startQ, (v) => v === `${D2}/${D2}`);
  await check("4. Change to D2 (one week earlier) is saved", s4 === `${D2}/${D2}`, e4 || s4);
  const a4 = sql(`SELECT count(*) FROM audit_log WHERE entity_id='${DANA}' AND action='enrolment_start_changed'`);
  await check("4b. …and audited (enrolment_start_changed)", a4 === "1", a4);

  // ── 5. Mark D2 — leave nothing unmarked (RISK 12) ────────────────────────
  const e5 = await act(() => mark(D2));
  const m2 = await dbUntil(markQ(D2), (v) => v !== "-");
  // Today's own lesson is legitimately expected (the class runs on today's weekday and
  // she is enrolled through today); the teardown removes it. What must be empty is
  // everything the BACKDATE created — every unmarked date before today.
  const unmarked = sql(`SELECT coalesce(string_agg(d::text, ','), '') FROM unnest(class_unmarked_lesson_dates('${CLASS}')) d
                         WHERE d < '${TODAY}'`);
  // NOT vacuous: requires both marks AND the enrolment, so "nobody enrolled, so
  // nothing unmarked" cannot pass it (it did, in the first run).
  await check("5. D1 and D2 both marked — the backdate left NO unmarked lesson before today",
    m2 === "present" && sql(markQ(D1)) === "present" && sql(startQ) === `${D2}/${D2}` && unmarked === "",
    e5 || `D2 mark ${m2}; unmarked: ${unmarked || "none"}`);

  await check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (results.length !== EXPECTED_CHECKS + 1) console.log(`(expected ${EXPECTED_CHECKS + 1} checks)`);
process.exit(passed === results.length && results.length === EXPECTED_CHECKS + 1 ? 0 : 1);
