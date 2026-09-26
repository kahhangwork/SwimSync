// verify-coach-remove-student.mjs — the coach roster's Remove (cancel AND
// accept, proved in the DATABASE) and the level curriculum's Hide, on
// (coach)/classes/[id]/roster. Before this driver neither was pressed by
// anything: verify-student-identity only reads Remove's label, and
// verify-level-skills only expands the curriculum.
//
// Fixture: fixtures-coach-remove-student.sql   Teardown: fixtures-coach-remove-student-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U3 (promotes the old docs/refactor
// coach-roster hand-check). BACKLOG item: "A driver for the coach roster's Remove".
//
// Logs in as coach-remove-coach@swimsync.test — a PLAIN coach (not an admin) of
// the fixture's OWN business, so close_student_enrolment() authorises through
// coach_owns_class(<this class>) and not the admin branch (§7.131).
//
// WHY. Remove is the coach's only way to stop a child who has left from
// keeping a class "incomplete" and blocking the month's invoicing. A regression
// fails silently: the confirm on RN-web is window.confirm, and a child in TWO
// classes must lose only THIS one. So the driver asserts, in the DB: this
// enrolment closed, the other class's enrolment still open, the child still
// active and still 'assigned', the classmate untouched, and the audit row names
// THIS class. The Cancel path asserts the dialog fired with its text AND the
// DB is unchanged — launch() auto-accepts dialogs, so this driver removes that
// listener and answers every dialog itself (§7.279).
//
// Navigation is by in-app taps (Classes tab → the class card), pressed by DOM
// on the VISIBLE screen only (§7.10/§7.58); screen text is read with
// visibleText(), never body.innerText. The browser clock is installed at
// today 12:00 SGT (plan rule 13) — nothing asserted here buckets by hour, but
// the Schedule landing does. The Toast lives 3000 ms: waited for right after
// the press.
//
// MUTATION PROOFS (§7.25) — each made on app code, the served Expo bundle
// grepped for the mutated text (present) and after the revert (absent)
// (§7.253), run, seen red, reverted (`git diff --exit-code -- SwimSyncApp` clean):
//
//   | # | mutation                                                                 | result | red checks |
//   |---|--------------------------------------------------------------------------|--------|------------|
//   | 1 | useRemoveStudent.ts:32 → `removeStudentFromClass(student.id, student.id)` | 15/20  | the success toast; "⚠ THIS class's enrolment is closed" (true/false); "one audit row… naming THIS class" (0); "Students (1)"; "Leaver no longer listed" — the RPC refuses a class the coach does not own |
//   | 2 | useRemoveStudent.ts:39 → `loadData();` deleted                            | 18/20  | "the roster re-reads: Students (1)" (still 2), "…and CoachRm Leaver is no longer listed" |
//
// Proof 1's first run had the PRECONDITION red and the audit check GREEN: the
// fixture did not delete the previous run's audit row, so a stale row
// satisfied it. The fixture now resets it; the re-measure above has it red.
// (2026-09-26, both reverted.)

import { execFileSync } from "node:child_process";
import { launch, loginExpo, pressByText, visibleText, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
for (const u of [ADMIN, EXPO]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) {
    console.error(`refusing to run against a non-local URL: ${u}`);
    process.exit(2);
  }
}

const EXPECTED_CHECKS = 20;

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
// Poll the VISIBLE screen's text until `ok` — never a bare sleep (rule 13).
async function screenUntil(page, ok, ms = 10000) {
  const end = Date.now() + ms;
  let t = await visibleText(page);
  while (!ok(t) && Date.now() < end) {
    await page.waitForTimeout(300);
    t = await visibleText(page);
  }
  return t;
}

const COACH = "b4000000-0000-0000-0000-0000000000a1";
const LEAVER = "b4000000-0000-0000-0000-0000000000d1";
const STAYER = "b4000000-0000-0000-0000-0000000000d2";
const MONDAY = "b4000000-0000-0000-0000-0000000000c1";
const WEDNESDAY = "b4000000-0000-0000-0000-0000000000c2";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// Press the "Remove" in the card that holds `childName`, on the visible screen.
// Walks up from the name and presses only when the subtree holds exactly ONE
// visible "Remove" and no second copy of the name — more means the walk has left the
// card and would press a classmate's button (same guard as pressClassButton).
// window.confirm blocks the page, so this evaluate resolves only once the
// dialog listener below has answered it — `dialogs` is filled by then.
const pressRemoveFor = (page, childName) =>
  page.evaluate((name) => {
    const vis = (e) => !e.closest('[aria-hidden="true"]') && e.getClientRects().length > 0;
    const leaves = (root, txt) => [...root.querySelectorAll("*")]
      .filter((e) => e.children.length === 0 && e.textContent.trim() === txt && vis(e));
    const names = leaves(document, name);
    if (names.length !== 1) return `name matched ${names.length} times`;
    let card = names[0];
    for (let i = 0; i < 12 && card; i++, card = card.parentElement) {
      const btns = leaves(card, "Remove");
      if (btns.length > 1 || leaves(card, name).length > 1) return "walked out of the card";
      if (btns.length === 1) {
        const opts = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
        const t = btns[0].parentElement;
        t.dispatchEvent(new PointerEvent("pointerdown", opts));
        t.dispatchEvent(new PointerEvent("pointerup", opts));
        t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return "ok";
      }
    }
    return "no Remove in the card";
  }, childName);

const todaySg = sql(`SELECT (now() AT TIME ZONE 'Asia/Singapore')::date`);
const { browser, ctx, page } = await launch({ mobile: true });
page.setDefaultTimeout(15000);
await ctx.clock.install({ time: new Date(`${todaySg}T12:00:00+08:00`) });

// Answer every dialog ourselves: `mode` says how, `dialogs` records what fired.
page.removeAllListeners("dialog");
let mode = "dismiss";
const dialogs = [];
page.on("dialog", (d) => {
  dialogs.push(d.message());
  (mode === "accept" ? d.accept() : d.dismiss()).catch(() => {});
});

const enrolQ = (sid, cid) =>
  `SELECT coalesce(string_agg(is_active::text || '/' || (unenrolled_at IS NOT NULL)::text, ','), '')
     FROM student_class_enrolments WHERE student_id='${sid}' AND class_id='${cid}'`;
const childQ = `SELECT is_active::text || '/' || assignment_status FROM students WHERE id='${LEAVER}'`;
const auditQ = `SELECT count(*) FROM audit_log WHERE entity_id='${LEAVER}'
                  AND action='student_removed_from_class' AND actor_id='${COACH}'
                  AND old_value->>'removed_from_class_id' = '${MONDAY}'`;

try {
  // ── 0. Preconditions: the fixture is freshly loaded ────────────────────────
  const pre = [enrolQ(LEAVER, MONDAY), enrolQ(LEAVER, WEDNESDAY), enrolQ(STAYER, MONDAY), childQ, auditQ].map(sql);
  check("PRECONDITION: Leaver open in Monday AND Wednesday, Stayer open in Monday, Leaver active+assigned, no removal audit",
    pre.join(" | ") === "true/false | true/false | true/false | true/assigned | 0", pre.join(" | "));

  // ── 1. Reach THIS class's roster by in-app taps ────────────────────────────
  await loginExpo(page, "coach-remove-coach@swimsync.test");
  await screenUntil(page, (t) => /\bClasses\b/.test(t));
  await pressByText(page, "Classes");
  await screenUntil(page, (t) => /CoachRm Monday/.test(t) && /My Classes/.test(t));
  await pressByText(page, "CoachRm Monday");
  let t = await screenUntil(page, (s) => /Students \(\d+\)/.test(s));
  check("the Monday roster opens with both children (Students (2))",
    /Students \(2\)/.test(t) && /CoachRm Leaver/.test(t) && /CoachRm Stayer/.test(t) && /Monday · 9:00/.test(t),
    t.slice(0, 200).replace(/\n/g, " "));

  // ── 2. The level curriculum: expand, then Hide ─────────────────────────────
  check("collapsed: 'What CoachRm Level covers' is offered, no skills shown",
    /What CoachRm Level covers/.test(t) && !/CoachRm Blow bubbles/.test(t));
  await pressByText(page, "What CoachRm Level covers");
  t = await screenUntil(page, (s) => /CoachRm Blow bubbles/.test(s));
  check("expanded: the label now reads 'Hide CoachRm Level'",
    /Hide CoachRm Level/.test(t) && !/What CoachRm Level covers/.test(t), t.match(/(What|Hide) CoachRm Level.{0,10}/)?.[0]);
  check("expanded: the level note is shown", /CoachRm water confidence/.test(t));
  check("expanded: skills in sort_order (1 Blow bubbles, 2 Float) though stored the other way",
    /1\s*CoachRm Blow bubbles\s*2\s*CoachRm Float/.test(t), t.match(/\d\s*CoachRm (Blow|Float)[\s\S]{0,40}/)?.[0]);
  await pressByText(page, "Hide CoachRm Level");
  t = await screenUntil(page, (s) => !/CoachRm Blow bubbles/.test(s));
  check("Hide collapses it again", /What CoachRm Level covers/.test(t) && !/CoachRm Blow bubbles|CoachRm Float/.test(t));

  // ── 3. Remove → Cancel: the dialog fires, NOTHING changes ──────────────────
  mode = "dismiss";
  let pressed = await pressRemoveFor(page, "CoachRm Leaver");
  if (pressed !== "ok") throw new Error(`Remove (cancel pass): ${pressed}`);
  const cancelMsg = dialogs[0] ?? "";
  check("the confirm names the child and THIS class",
    dialogs.length === 1 && /^CoachRm Leaver will be removed from THIS class\. Any other class they attend is untouched/.test(cancelMsg),
    `${dialogs.length} dialog(s): ${cancelMsg.slice(0, 80)}`);
  // Give a wrongly-proceeding write time to land before reading "unchanged".
  await page.waitForTimeout(1500);
  const afterCancel = [enrolQ(LEAVER, MONDAY), enrolQ(LEAVER, WEDNESDAY), childQ].map(sql);
  check("Cancel: the database is unchanged (both enrolments open, child active+assigned)",
    afterCancel.join(" | ") === "true/false | true/false | true/assigned", afterCancel.join(" | "));
  t = await visibleText(page);
  check("Cancel: the roster still lists 2 students", /Students \(2\)/.test(t) && /CoachRm Leaver/.test(t));

  // ── 4. Remove → OK ─────────────────────────────────────────────────────────
  mode = "accept";
  pressed = await pressRemoveFor(page, "CoachRm Leaver");
  if (pressed !== "ok") throw new Error(`Remove (accept pass): ${pressed}`);
  check("the second press asks again (a fresh confirm)", dialogs.length === 2, `${dialogs.length} dialog(s)`);
  const toast = await page.getByText("CoachRm Leaver removed from this class.").first()
    .waitFor({ state: "visible", timeout: 10000 }).then(() => true, () => false);
  const errToast = await page.getByText("Could not remove CoachRm Leaver.").count();
  check("the success toast 'CoachRm Leaver removed from this class.'", toast, errToast ? "the ERROR toast showed instead" : "");

  const monday = await dbUntil(enrolQ(LEAVER, MONDAY), (v) => v === "false/true");
  check("⚠ THIS class's enrolment is closed (is_active false, unenrolled_at set)", monday === "false/true", monday);
  check("⚠ the OTHER class's enrolment (Wednesday) is still open", sql(enrolQ(LEAVER, WEDNESDAY)) === "true/false",
    sql(enrolQ(LEAVER, WEDNESDAY)));
  const child = sql(childQ);
  check("⚠ the child is still ACTIVE (students.is_active true)", child.startsWith("true/"), child);
  check("…and still 'assigned' (they are in one class yet)", child.endsWith("/assigned"), child);
  check("the classmate's Monday enrolment is untouched", sql(enrolQ(STAYER, MONDAY)) === "true/false",
    sql(enrolQ(STAYER, MONDAY)));
  const audit = await dbUntil(auditQ, (v) => v === "1");
  check("one audit row, by this coach, naming THIS class as the one removed from", audit === "1", `rows ${audit}`);

  t = await screenUntil(page, (s) => /Students \(1\)/.test(s));
  check("the roster re-reads: Students (1)", /Students \(1\)/.test(t), t.match(/Students \(\d+\)/)?.[0]);
  const listed = t.replace(/CoachRm Leaver removed from this class\./g, "");
  check("…and CoachRm Leaver is no longer listed (CoachRm Stayer still is)",
    !/CoachRm Leaver/.test(listed) && /CoachRm Stayer/.test(listed));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/coach-remove-student-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
