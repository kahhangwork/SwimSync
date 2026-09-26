// verify-coach-marking.mjs — the coach marking screen,
// (coach)/classes/[id]/attendance, on the three things no driver asserted:
//
//   1. A Present → Absent CORRECTION on an INVOICED lesson issues exactly one
//      credit note (handle_attendance_update) AND the screen sends exactly ONE
//      credit-note-emails request for that lesson — while a NO-CHANGE re-save
//      issues nothing and sends ZERO (the `mayHaveIssuedCreditNote` guard,
//      features/mark-attendance/domain/useSaveAttendance.ts:235).
//   2. The FIRST save of a lesson with no lesson_sessions row creates exactly
//      one, the attendance attaches to it, and one attendance_saved audit row
//      names it.
//   3. The title: a class SHADOW gets the read-only "Lesson Attendance" (no
//      Save button, the shadowing notice); the main coach gets "Mark
//      Attendance" on the SAME class (features/mark-attendance/ui/
//      AttendanceHeader.tsx:30, decided by lib/coachRoster.ts canMark).
//
// Fixture: fixtures-coach-marking.sql   Teardown: fixtures-coach-marking-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U10 (promotes the old docs/refactor
// coach-attendance hand-check). BACKLOG item: "A driver for the coach marking
// screen's credit-note email and read-only title".
//
// OWN BUSINESS (CoachMark Swim), own PLAIN coach and own shadow coach — never
// the seed coach, who is also the seed tenant's admin (§7.131). The billed
// lesson sits on D = 5 days before the 1st of this month, i.e. inside LAST
// month (§7.226); its invoice is unsealed (the tenant has no billing_periods).
// D is READ from the DB, never recomputed here (plan rule 4). Every DB count is
// scoped to the fixture's ids (rule 5); the credit-note count is by the
// fixture's invoice item, not a global count(*).
//
// Reached by DEEP LINK after an in-app login. Since §7.254's product fix the
// requested coach screen is the VISIBLE one; this driver still reads only
// visibleText() and presses only on the visible screen (§7.10/§7.58), and every
// text assertion is on a string unique to the marking screen. The browser
// clock is pinned to today 12:00 SGT (rule 13). No dialog is involved; the
// auto-accept listener is removed anyway so a surprise confirm cannot be
// silently accepted (§7.279) — a dialog here is recorded and fails a check.
//
// supabase/functions/.env has no RESEND_API_KEY, so the local credit-note-emails
// function answers "no_api_key" and no mail leaves the machine. The driver
// counts the REQUEST the app makes (POST /functions/v1/credit-note-emails),
// which is what the guard decides.
//
// MUTATION PROOFS (§7.25) — each made on app code, the served Expo bundle
// grepped for the mutated code (present) and after the revert (absent)
// (§7.253), run, seen red, reverted (`git diff --exit-code -- SwimSyncApp` clean):
//
//   | # | mutation | result | red checks |
//   |---|----------|--------|------------|
//   | 1 | useSaveAttendance.ts:235 → `if (true \|\| mayHaveIssuedCreditNote(…))` | 29/31 | "⚠ no-change re-save: ZERO credit-note-emails requests" (1), "a first Present save sends NO credit-note-emails request" (1) |
//   | 2 | lib/coachRoster.ts:172 → `… \|\| role === "shadow"` (a shadow may mark)  | 29/31 | "⚠ the shadow's screen is titled 'Lesson Attendance'" (it read Mark Attendance), "…with NO Save button" |
//
// (2026-09-26, both reverted; the served bundle held `if (true || (0, _creditNoteEmail…` /
// `role === "shadow";` after each edit and neither after each revert.) Mutation 2 also shows the
// shadowing notice ABOVE a Save button — the notice alone would not have caught it.

import { execFileSync } from "node:child_process";
import { launch, loginExpo, pressByText, visibleText, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
const API_URL = "http://127.0.0.1:54321";
for (const u of [ADMIN, EXPO]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) {
    console.error(`refusing to run against a non-local URL: ${u}`);
    process.exit(2);
  }
}

const EXPECTED_CHECKS = 31;

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
async function screenUntil(page, ok, ms = 20000) {
  const end = Date.now() + ms;
  let t = await visibleText(page);
  while (!ok(t) && Date.now() < end) {
    await page.waitForTimeout(300);
    t = await visibleText(page);
  }
  return t;
}

const TENANT = "d7000000-0000-0000-0000-000000000001";
const BILLED = "d7000000-0000-0000-0000-0000000000c1";
const FRESH = "d7000000-0000-0000-0000-0000000000c2";
const SHADOWED = "d7000000-0000-0000-0000-0000000000c3";
const BILLED_SESSION = "d7000000-0000-0000-0000-0000000000e1";
const BILLED_ITEM = "d7000000-0000-0000-0000-0000000001b1";
const BILLEDKID = "d7000000-0000-0000-0000-0000000000d1";
const FRESHKID = "d7000000-0000-0000-0000-0000000000d3";
const PARENT_PROFILE = "d7000000-0000-0000-0000-0000000000f1";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// Press the status button `label` inside the card that names `childName`, on
// the visible screen. Walks up from the name and presses only when the subtree
// holds exactly ONE visible `label` and one copy of the name — more means the
// walk has left the card and would press a classmate's button.
const pressInCard = (page, childName, label) =>
  page.evaluate(([name, label]) => {
    const vis = (e) => !e.closest('[aria-hidden="true"]') && e.getClientRects().length > 0;
    const leaves = (root, txt) => [...root.querySelectorAll("*")]
      .filter((e) => e.children.length === 0 && e.textContent.trim() === txt && vis(e));
    const names = leaves(document, name);
    if (names.length !== 1) return `name matched ${names.length} times`;
    let card = names[0];
    for (let i = 0; i < 12 && card; i++, card = card.parentElement) {
      const btns = leaves(card, label);
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
    return `no ${label} in the card`;
  }, [childName, label]);

const D = sql(`SELECT session_date FROM lesson_sessions WHERE id='${BILLED_SESSION}'`);
const todaySg = sql(`SELECT today_sg()`);
const attendanceUrl = (cls, from) =>
  `${EXPO}/classes/${cls}/attendance?date=${D}${from ? `&from=${from}` : ""}`;

// ── Scoped queries ──────────────────────────────────────────────────────────
const billedQ = `SELECT coalesce(string_agg(s.full_name || ':' || a.status, ',' ORDER BY s.full_name), '')
                   FROM attendance a JOIN students s ON s.id = a.student_id
                  WHERE a.lesson_session_id = '${BILLED_SESSION}'`;
const notesQ = `SELECT count(*) FROM credit_notes WHERE invoice_item_id = '${BILLED_ITEM}'`;
const noteQ = `SELECT amount || '/' || original_status || '/' || corrected_status || '/' || status
                        || '/' || lesson_session_id
                 FROM credit_notes WHERE invoice_item_id = '${BILLED_ITEM}'`;
const balanceQ = `SELECT coalesce((SELECT b.credit_balance::text FROM parent_tenant_balances b
                                     JOIN parents p ON p.id = b.parent_id
                                    WHERE p.profile_id = '${PARENT_PROFILE}' AND b.tenant_id = '${TENANT}'), 'none')`;
const auditQ = (entity) => `SELECT count(*) FROM audit_log
                             WHERE entity_id = '${entity}' AND action = 'attendance_saved'`;
const freshSessionsQ = `SELECT coalesce(string_agg(id::text || '@' || session_date, ','), '')
                          FROM lesson_sessions WHERE class_id = '${FRESH}'`;
const shadowSessionsQ = `SELECT count(*) FROM lesson_sessions WHERE class_id = '${SHADOWED}'`;

// Every browser this driver opens: rule-14 origin guard, dialog recorder, and
// the credit-note-emails request log.
const cnRequests = [];
const dialogs = [];
const apiOrigins = new Set();
async function openCoach(email) {
  const { browser, ctx, page } = await launch({ mobile: true });
  page.setDefaultTimeout(15000);
  await ctx.clock.install({ time: new Date(`${todaySg}T12:00:00+08:00`) });
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (/^\/(auth|rest|functions)\/v1\//.test(u.pathname)) apiOrigins.add(u.origin);
    if (u.pathname.endsWith("/functions/v1/credit-note-emails") && r.method() === "POST") {
      cnRequests.push(r.postData() ?? "");
    }
  });
  await loginExpo(page, email);
  // Rule 14, the API half: the app must be talking to the LOCAL stack before
  // this driver lets it write anything.
  const foreign = [...apiOrigins].filter((o) => o !== API_URL);
  if (apiOrigins.size === 0 || foreign.length) {
    console.error(`refusing: the app's API origin is not ${API_URL} (${[...apiOrigins].join(", ") || "none seen"})`);
    await browser.close();
    process.exit(2);
  }
  return { browser, page };
}

// Open a marking screen by deep link and wait for the named child's card.
async function openMarking(page, cls, from, childName) {
  await page.goto(attendanceUrl(cls, from), { waitUntil: "domcontentloaded" });
  return screenUntil(page, (t) => t.includes(childName) && /(Save Attendance|You're shadowing)/.test(t), 30000);
}

// Press Save and wait for the success toast (it lives 3000 ms, §7.58).
async function saveAndToast(page) {
  if (!(await pressByText(page, "Save Attendance"))) return false;
  return page.getByText("Attendance saved.").first()
    .waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
}

async function pathUntil(page, ok, ms = 10000) {
  const end = Date.now() + ms;
  let p = new URL(page.url()).pathname;
  while (!ok(p) && Date.now() < end) {
    await page.waitForTimeout(300);
    p = new URL(page.url()).pathname;
  }
  return p;
}

let coach = null;
let shadow = null;
try {
  // ── 0. Preconditions: the fixture is freshly loaded ────────────────────────
  const pre = [billedQ, notesQ, balanceQ, auditQ(BILLED_SESSION), freshSessionsQ, shadowSessionsQ,
    `SELECT count(*) FROM billing_periods WHERE tenant_id='${TENANT}'`].map(sql);
  check("PRECONDITION: Billed lesson both present, 0 notes, no balance, 0 audit, no Fresh/Shadowed session, month unsealed",
    pre.join(" | ") === "CoachMark Billedkid:present,CoachMark Otherkid:present | 0 | none | 0 |  | 0 | 0",
    pre.join(" | "));
  const dMonth = D.slice(0, 7);
  const thisMonth = todaySg.slice(0, 7);
  check("PRECONDITION: the billed lesson D is in LAST month and the invoice bills that month",
    /^\d{4}-\d{2}-\d{2}$/.test(D) && dMonth < thisMonth
      && sql(`SELECT billing_month FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
               WHERE ii.id = '${BILLED_ITEM}'`) === dMonth,
    `D=${D} today=${todaySg}`);

  coach = await openCoach("coach-marking-coach@swimsync.test");
  const page = coach.page;

  // ── 1. The correction: Present → Absent on the INVOICED lesson ─────────────
  let t = await openMarking(page, BILLED, "roster", "CoachMark Billedkid");
  check("the main coach's screen is titled 'Mark Attendance' with a Save button",
    /(^|\n)Mark Attendance\n/.test(t) && !/Lesson Attendance/.test(t) && /Save Attendance/.test(t)
      && /CoachMark Billed · /.test(t),
    t.slice(0, 120).replace(/\n/g, " | "));

  const n0 = cnRequests.length;
  const pressed = await pressInCard(page, "CoachMark Billedkid", "Absent");
  if (pressed !== "ok") throw new Error(`Absent for Billedkid: ${pressed}`);
  const toast1 = await saveAndToast(page);
  check("the correction saves ('Attendance saved.')", toast1);

  const notes1 = await dbUntil(notesQ, (v) => v === "1");
  check("⚠ exactly ONE credit note for the invoiced lesson (was 0)", notes1 === "1", `notes ${notes1}`);
  const note = sql(noteQ);
  check("…for S$30.00, present → absent, available, on the billed lesson",
    note === `30.00/present/absent/available/${BILLED_SESSION}`, note);
  const bal = sql(balanceQ);
  check("…and the parent's credit balance with this business is S$30.00 (was none)", bal === "30.00", bal);
  const billed1 = sql(billedQ);
  check("DB: Billedkid absent, Otherkid still present",
    billed1 === "CoachMark Billedkid:absent,CoachMark Otherkid:present", billed1);
  const req1 = cnRequests.slice(n0);
  check("⚠ exactly ONE credit-note-emails request after the correcting save", req1.length === 1,
    `${req1.length} request(s)`);
  let body = null;
  try { body = JSON.parse(req1[0] ?? "null"); } catch { body = null; }
  check("…naming the billed lesson ({ lesson_session_id })", body?.lesson_session_id === BILLED_SESSION,
    req1[0] ?? "no request");
  let path = await pathUntil(page, (p) => p.endsWith(`/classes/${BILLED}/roster`));
  check("the save leaves to the roster (from=roster)", path.endsWith(`/classes/${BILLED}/roster`), path);

  // ── 2. A NO-CHANGE re-save: no note, NO request ────────────────────────────
  t = await openMarking(page, BILLED, "roster", "CoachMark Billedkid");
  check("the re-opened screen loads the lesson (Billedkid + Otherkid, Save offered)",
    /CoachMark Billedkid/.test(t) && /CoachMark Otherkid/.test(t) && /Save Attendance/.test(t));
  const n1 = cnRequests.length;
  const toast2 = await saveAndToast(page);
  check("the no-change re-save saves ('Attendance saved.')", toast2);
  const audit2 = await dbUntil(auditQ(BILLED_SESSION), (v) => v === "2");
  check("two attendance_saved audit rows for the billed lesson now (one per save)", audit2 === "2", `rows ${audit2}`);
  path = await pathUntil(page, (p) => p.endsWith(`/classes/${BILLED}/roster`));
  const notes2 = sql(notesQ);
  check("no-change re-save: still exactly ONE credit note (+0)", notes2 === "1", `notes ${notes2}`);
  check("⚠ no-change re-save: ZERO credit-note-emails requests (the guard skips it)",
    cnRequests.length - n1 === 0, `${cnRequests.length - n1} request(s)`);
  check("…and the attendance is unchanged (Billedkid absent, Otherkid present)",
    sql(billedQ) === "CoachMark Billedkid:absent,CoachMark Otherkid:present", sql(billedQ));

  // ── 3. The FIRST save of a lesson with no session row ─────────────────────
  check("PRECONDITION: the Fresh class has no lesson_sessions row", sql(freshSessionsQ) === "", sql(freshSessionsQ));
  t = await openMarking(page, FRESH, null, "CoachMark Freshkid");
  check("the Fresh screen shows Freshkid unmarked ('Not yet marked')",
    /CoachMark Freshkid/.test(t) && /Not yet marked/.test(t) && /CoachMark Fresh · /.test(t));
  const n2 = cnRequests.length;
  const pressedFresh = await pressInCard(page, "CoachMark Freshkid", "Present");
  if (pressedFresh !== "ok") throw new Error(`Present for Freshkid: ${pressedFresh}`);
  const toast3 = await saveAndToast(page);
  check("the first save saves ('Attendance saved.')", toast3);
  const fresh = await dbUntil(freshSessionsQ, (v) => v !== "");
  const [sid, sdate] = fresh.split("@");
  check("⚠ exactly ONE lesson_sessions row created, on D",
    fresh !== "" && !fresh.includes(",") && sdate === D, fresh || "none");
  const freshAtt = sql(`SELECT coalesce(string_agg(lesson_session_id::text || ':' || status, ','), '')
                          FROM attendance WHERE student_id = '${FRESHKID}'`);
  check("the attendance row attaches to it, status present", freshAtt === `${sid}:present`, freshAtt);
  const audit3 = await dbUntil(auditQ(sid), (v) => v === "1");
  check("exactly one attendance_saved audit row for the new session (by entity id)", audit3 === "1", `rows ${audit3}`);
  check("a first Present save sends NO credit-note-emails request", cnRequests.length - n2 === 0,
    `${cnRequests.length - n2} request(s)`);
  path = await pathUntil(page, (p) => p === "/schedule");
  check("the save leaves to Schedule (no from)", path === "/schedule", path);

  // ── 4. The main coach on the SHADOWED class: markable ──────────────────────
  t = await openMarking(page, SHADOWED, "roster", "CoachMark Shadowkid");
  check("the main coach sees the Shadowed class as 'Mark Attendance' with Save",
    /(^|\n)Mark Attendance\n/.test(t) && !/Lesson Attendance/.test(t) && /Save Attendance/.test(t)
      && /CoachMark Shadowed · /.test(t),
    t.slice(0, 120).replace(/\n/g, " | "));
  await coach.browser.close();
  coach = null;

  // ── 5. The SHADOW on the same class: read-only ─────────────────────────────
  shadow = await openCoach("coach-marking-shadow@swimsync.test");
  t = await openMarking(shadow.page, SHADOWED, "roster", "CoachMark Shadowkid");
  check("⚠ the shadow's screen is titled 'Lesson Attendance' (not 'Mark Attendance')",
    /(^|\n)Lesson Attendance\n/.test(t) && !/Mark Attendance/.test(t) && /CoachMark Shadowed · /.test(t),
    t.slice(0, 120).replace(/\n/g, " | "));
  check("…with NO Save button", !/Save Attendance/.test(t));
  check("…and the shadowing notice", /You're shadowing this lesson/.test(t) && /The main coach records attendance/.test(t));
  check("the shadow's visit wrote no lesson_sessions row", sql(shadowSessionsQ) === "0", sql(shadowSessionsQ));
  check("no dialog fired anywhere in the run", dialogs.length === 0, dialogs.join(" / "));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  const shotDir = process.env.SHOT_DIR;
  for (const b of [coach, shadow]) {
    if (!b) continue;
    if (shotDir) await b.page.screenshot({ path: `${shotDir}/coach-marking-final.png`, fullPage: true }).catch(() => {});
    await b.browser.close().catch(() => {});
  }
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
