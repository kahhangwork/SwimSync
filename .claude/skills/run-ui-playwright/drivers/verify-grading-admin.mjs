// verify-grading-admin.mjs — the admin grading actions no other driver presses:
// Trials (Convert's two-press guard, Cancel), Make-ups (the multi-class "which
// class is this making up?" select, Change, Cancel), Levels (grading-scale
// add / rename / remove + the held-grade refusal, skill Move down / Remove,
// level Edit), Assessment (Move up offered WITHOUT a reload once re-painted —
// the 6abe8c2 fix — and pressed), and a grade written from the Students drawer.
//
// Fixture: fixtures-grading-admin.sql   Teardown: fixtures-grading-admin-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U1. BACKLOG item: "A verify-grading-admin driver…".
//
// Logs in as grading-admin-owner@swimsync.test — the owner-admin of the
// fixture's OWN business. The grading scale is per business and every grading
// surface reads it, so editing the seed tenant's scale would move "the top
// grade" under verify-assessment (plan rule 12).
//
// WHY THESE, AND WHICH ONES ARE BILLING-ADJACENT. Convert stacks a permanent
// enrolment on a child; if they still hold a future trial, that unmarked
// booking blocks the month's invoicing — the guard makes the admin press twice.
// A multi-class child's make-up snapshots its HOME class onto the booking and
// that class prices the invoice line; the RPC refuses to guess. Both fail
// silently until an invoice run, which is why every write here is asserted in
// the DATABASE, before AND after (plan rule 5), not only on screen.
//
// MUTATION PROOFS (§7.25) — each made on app code, run, seen red, reverted
// (`git diff --exit-code -- SwimSyncAdmin` clean after):
//
//   | # | mutation                                                        | result | red checks |
//   |---|-----------------------------------------------------------------|--------|------------|
//   | 1 | trials/domain/trialConvert.ts:25 → `return false;`              | 1/27   | "the FIRST Convert press warns…" (modal closed), "the first press wrote NO enrolment" (enrolments 1) |
//   | 2 | makeups/domain/useMakeups.ts:153 → `p_home_class_id: null`      | 10/27  | "the booking carries the CHOSEN home class" (no booking — the RPC refuses to guess) |
//
// (2026-09-26, both reverted; `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean.)

import { execFileSync } from "node:child_process";
import { launch, loginAdmin, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
for (const u of [ADMIN, EXPO]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) {
    console.error(`refusing to run against a non-local URL: ${u}`);
    process.exit(2);
  }
}

const EXPECTED_CHECKS = 27;

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

const TENANT = "c3000000-0000-0000-0000-000000000001";
const TRIALKID = "c3000000-0000-0000-0000-0000000000d1";
const TWOCLASS = "c3000000-0000-0000-0000-0000000000d2";
const PROMO = "c3000000-0000-0000-0000-0000000000d3";
const MODALKID = "c3000000-0000-0000-0000-0000000000d5";
const CLASS_TUE = "c3000000-0000-0000-0000-0000000000c1";
const CLASS_THU = "c3000000-0000-0000-0000-0000000000c2";
const CLASS_SAT = "c3000000-0000-0000-0000-0000000000c3";
const LEVEL_TWO = "c3000000-0000-0000-0000-0000000001e2";
const LEVEL_THREE = "c3000000-0000-0000-0000-0000000001e3";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
// The Modal primitive has no role; its overlay is the fixed z-50 layer.
const modal = (page) => page.locator("div.fixed.inset-0.z-50").last();

const { browser, page } = await launch({ headless: true });
page.setDefaultTimeout(15000);
if (process.env.SHOT_DIR) console.log("shots:", process.env.SHOT_DIR);

try {
  await loginAdmin(page, "grading-admin-owner@swimsync.test");

  // ── 1. Trials: Convert's two-press guard ───────────────────────────────────
  const enrolQ = `SELECT count(*) FROM student_class_enrolments WHERE student_id='${TRIALKID}' AND is_active`;
  const liveQ = `SELECT count(*) FROM trial_bookings WHERE student_id='${TRIALKID}' AND cancelled_at IS NULL`;
  check("PRECONDITION: the trial child has 0 enrolments and 2 live trials (one past, one future)",
    sql(enrolQ) === "0" && sql(liveQ) === "2", `enrolments ${sql(enrolQ)}, live trials ${sql(liveQ)}`);

  await page.goto(`${ADMIN}/trials`, { waitUntil: "networkidle" });
  await page.getByText("GradAdm Trialkid").first().waitFor({ timeout: 15000 });
  const pastPanel = page.locator("div", { hasText: /trials? still need marking/ }).last();
  await pastPanel.getByRole("button", { name: "Convert to enrolled" }).first().click();
  await modal(page).getByRole("button", { name: "Convert to enrolled" }).click();
  await modal(page).getByText(/still has a trial booked for/).waitFor({ timeout: 10000 }).catch(() => {});
  // A first press that wrongly enrols closes the modal — read "(closed)" and let
  // the two checks below go red by name, rather than crash on a missing modal.
  const warned = await modal(page).innerText({ timeout: 3000 }).catch(() => "(modal closed)");
  check("the FIRST Convert press warns about the future trial and asks again",
    /still has a trial booked for/.test(warned) && /Convert anyway/.test(warned),
    warned.replace(/\n/g, " | ").slice(0, 220));
  // Give a wrongly-enrolling first press time to land before reading "still 0".
  await page.waitForTimeout(1500);
  check("⚠ the first press wrote NO enrolment", sql(enrolQ) === "0", `enrolments ${sql(enrolQ)}`);

  await modal(page).getByRole("button", { name: "Convert anyway" }).click();
  const enrolled = await dbUntil(
    `SELECT count(*) FROM student_class_enrolments WHERE student_id='${TRIALKID}' AND class_id='${CLASS_TUE}' AND is_active`,
    (v) => v === "1");
  check("the SECOND press enrols the child into the trial's class", enrolled === "1", `rows ${enrolled}`);
  check("and marks them assigned",
    sql(`SELECT assignment_status FROM students WHERE id='${TRIALKID}'`) === "assigned");

  // Cancel the FUTURE trial from the Upcoming table.
  await page.waitForTimeout(800);
  const upcomingRow = page.locator("tr", { hasText: "GradAdm Trialkid" }).last();
  await upcomingRow.getByRole("button", { name: "Cancel" }).click();
  const futureCancelled = await dbUntil(
    `SELECT count(*) FROM trial_bookings WHERE student_id='${TRIALKID}' AND cancelled_at IS NOT NULL
        AND session_date > (now() AT TIME ZONE 'Asia/Singapore')::date`, (v) => v === "1");
  check("Cancel on the upcoming trial cancels THAT booking", futureCancelled === "1", `cancelled future ${futureCancelled}`);
  check("…and leaves the past trial live (it still needs marking)", sql(liveQ) === "1", `live ${sql(liveQ)}`);

  // ── 2. Make-ups: a multi-class child ───────────────────────────────────────
  const bookQ = `SELECT class_id||'/'||home_class_id FROM makeup_bookings WHERE student_id='${TWOCLASS}' AND cancelled_at IS NULL`;
  check("PRECONDITION: the two-class child has no live make-up", sql(bookQ) === "", sql(bookQ));

  await page.goto(`${ADMIN}/makeups`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Book a make-up" }).click();
  const search = page.getByPlaceholder("Search by child or class…");
  await search.fill("Twoclass");
  await modal(page).getByRole("button", { name: /GradAdm Twoclass/ }).click();
  const homeSelect = page.getByLabel("Which class is this making up?");
  await homeSelect.waitFor({ timeout: 8000 }).catch(() => {});
  const homeOpts = (await homeSelect.locator("option").allInnerTexts().catch(() => [])).join(",");
  const askText = await modal(page).innerText();
  check("a child in TWO classes is asked which class the make-up replaces",
    /GradAdm Tuesday/.test(homeOpts) && /GradAdm Thursday/.test(homeOpts) && /is in 2 classes/.test(askText),
    homeOpts);

  await modal(page).getByRole("button", { name: "Change" }).click();
  check("Change un-picks the child and re-opens the search",
    await search.isVisible().catch(() => false));

  await search.fill("Twoclass");
  await modal(page).getByRole("button", { name: /GradAdm Twoclass/ }).click();
  await homeSelect.selectOption({ label: "GradAdm Thursday" });
  await page.getByLabel("Class to join").selectOption({ label: "GradAdm Saturday" });
  // The date select is the modal's last; its label's accessible name also
  // carries the hint text below it, so it is not addressable as "Lesson".
  const lesson = modal(page).locator("select").last();
  await lesson.locator("option").nth(1).waitFor({ state: "attached", timeout: 10000 });
  // Strictly AFTER today: a make-up dated today sits under "needs marking", not
  // in the Upcoming table this driver cancels it from. Today comes from the DB.
  const todaySg = sql(`SELECT (now() AT TIME ZONE 'Asia/Singapore')::date`);
  const dates = await lesson.locator("option").evaluateAll((os) => os.map((o) => o.value));
  const futureDate = dates.find((d) => d > todaySg);
  if (!futureDate) throw new Error(`no make-up date after ${todaySg} offered: ${dates}`);
  await lesson.selectOption(futureDate);
  await modal(page).getByRole("button", { name: "Book the make-up" }).click();
  const booked = await dbUntil(bookQ, (v) => v !== "");
  check("⚠ the booking carries the CHOSEN home class (Thursday), hosted by Saturday",
    booked === `${CLASS_SAT}/${CLASS_THU}`, `class/home = ${booked || "(no booking)"}`);

  await page.waitForTimeout(800);
  await page.locator("tr", { hasText: "GradAdm Twoclass" }).first()
    .getByRole("button", { name: "Cancel" }).click();
  const mkCancelled = await dbUntil(
    `SELECT count(*) FROM makeup_bookings WHERE student_id='${TWOCLASS}' AND cancelled_at IS NOT NULL`,
    (v) => v === "1");
  check("Cancel on an upcoming make-up cancels it", mkCancelled === "1", `cancelled ${mkCancelled}`);

  // ── 3. Levels: the grading scale ───────────────────────────────────────────
  const scaleQ = `SELECT string_agg(label, ',' ORDER BY rank) FROM skill_grade_levels WHERE tenant_id='${TENANT}'`;
  check("PRECONDITION: the scale is the seeded three", sql(scaleQ) === "Developing,Competent,Mastered", sql(scaleQ));

  await page.goto(`${ADMIN}/levels`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Grading scale" }).click();
  await page.getByPlaceholder("Expert").fill("GradAdm Elite");
  await modal(page).getByRole("button", { name: "Add grade" }).click();
  const added = await dbUntil(scaleQ, (v) => v.endsWith(",GradAdm Elite"));
  check("Add grade appends it to the TOP of the scale", added === "Developing,Competent,Mastered,GradAdm Elite", added);

  const eliteInput = modal(page).locator('input[value="GradAdm Elite"]');
  await eliteInput.waitFor({ timeout: 8000 });
  await eliteInput.fill("GradAdm Supreme");
  await eliteInput.press("Enter");
  const renamed = await dbUntil(scaleQ, (v) => v.includes("GradAdm Supreme"));
  check("renaming a grade (Enter) saves the new label", renamed.endsWith(",GradAdm Supreme"), renamed);

  await modal(page).locator('li:has(input[value="GradAdm Supreme"])')
    .getByRole("button", { name: "Remove grade" }).click();
  const removed = await dbUntil(scaleQ, (v) => !v.includes("GradAdm"));
  check("Remove grade deletes an unused grade", removed === "Developing,Competent,Mastered", removed);

  await modal(page).locator('li:has(input[value="Developing"])')
    .getByRole("button", { name: "Remove grade" }).click();
  await modal(page).getByText(/graded at this level/).waitFor({ timeout: 8000 }).catch(() => {});
  const refusal = await modal(page).innerText();
  check("⚠ removing a grade a child HOLDS is refused, and says why",
    /A child has been graded at this level/.test(refusal) && sql(scaleQ) === "Developing,Competent,Mastered",
    `${refusal.match(/A child has been[^\n]*/)?.[0] ?? "(no refusal)"} · scale ${sql(scaleQ)}`);
  await modal(page).getByRole("button", { name: "Done" }).click();

  // ── 4. Levels: skills and the level form ───────────────────────────────────
  const skillsQ = `SELECT string_agg(label, ',' ORDER BY sort_order) FROM tenant_level_skills WHERE level_id='${LEVEL_THREE}'`;
  check("PRECONDITION: Level Three's skills are Tread, Dive, Scull",
    sql(skillsQ) === "GradAdm Tread,GradAdm Dive,GradAdm Scull", sql(skillsQ));

  await page.locator("tr", { hasText: "GradAdm Level Three" }).first()
    .getByRole("button", { name: /3 skills/ }).click();
  await page.locator("li", { hasText: "GradAdm Tread" }).getByRole("button", { name: "Move down" }).click();
  const moved = await dbUntil(skillsQ, (v) => v.startsWith("GradAdm Dive"));
  check("Move down swaps a skill with the one below it", moved === "GradAdm Dive,GradAdm Tread,GradAdm Scull", moved);

  await page.waitForTimeout(600);
  await page.locator("li", { hasText: "GradAdm Scull" }).getByRole("button", { name: "Remove skill" }).click();
  const pruned = await dbUntil(skillsQ, (v) => !v.includes("Scull"));
  check("Remove skill deletes an ungraded skill", pruned === "GradAdm Dive,GradAdm Tread", pruned);

  await page.locator("tr", { hasText: "GradAdm Level Three" }).first()
    .getByRole("button", { name: "Edit" }).click();
  await page.getByPlaceholder("Progress to B3 upon completing T4").fill("GradAdm edited note");
  await modal(page).getByRole("button", { name: "Save" }).click();
  const note = await dbUntil(`SELECT coalesce(note,'') FROM tenant_levels WHERE id='${LEVEL_THREE}'`,
    (v) => v === "GradAdm edited note");
  check("Edit saves a level's note", note === "GradAdm edited note", note);

  // ── 5. Assessment: Move up without a reload ───────────────────────────────
  await page.goto(`${ADMIN}/assessment`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "GradAdm Saturday", exact: true }).click();
  const promoRow = () => page.locator("tr", { hasText: "GradAdm Promo" }).first();
  await promoRow().waitFor({ timeout: 15000 });
  check("PRECONDITION: a child holding 90-day-old top grades is NOT offered Move up",
    !/Move up/.test(await promoRow().innerText()), (await promoRow().innerText()).replace(/\n/g, " "));

  await page.getByRole("button", { name: "Mastered", exact: true }).first().click();
  await promoRow().getByRole("button", { name: /^All / }).click();
  // No reload: the re-painted row must offer the promotion on its own (6abe8c2).
  const moveUp = promoRow().getByRole("button", { name: /Move up to GradAdm Level Two/ });
  const offered = await moveUp.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("re-painting today's top grades offers Move up WITHOUT a reload", offered,
    (await promoRow().innerText()).replace(/\n/g, " "));

  await page.keyboard.press("Escape");
  if (offered) await moveUp.click();
  const level = await dbUntil(`SELECT coalesce(level_id::text,'') FROM students WHERE id='${PROMO}'`,
    (v) => v === LEVEL_TWO);
  check("Move up moves the child to the next level", level === LEVEL_TWO, level);
  const flash = await page.getByText("GradAdm Promo moved up to GradAdm Level Two.")
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("and says so (the message survives the re-read)", flash);

  // ── 6. Students drawer → Grade skills ─────────────────────────────────────
  const modalGradesQ = `SELECT count(*) FROM student_skill_progress WHERE student_id='${MODALKID}'`;
  check("PRECONDITION: the modal child has no grades", sql(modalGradesQ) === "0", sql(modalGradesQ));

  await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
  await page.locator("tr", { hasText: "GradAdm Modalkid" }).first()
    .getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("button", { name: "Grade skills", exact: true }).click();
  await modal(page).getByText("Grade GradAdm Modalkid").waitFor({ timeout: 10000 });
  await modal(page).locator("tr", { hasText: "GradAdm Modalkid" }).getByRole("button", { name: "—" })
    .first().click();
  const graded = await dbUntil(modalGradesQ, (v) => v === "1");
  check("a grade clicked in the Students drawer's modal is written", graded === "1", `grades ${graded}`);
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/grading-admin-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
