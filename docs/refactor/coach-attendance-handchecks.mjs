// Stage 4 hand-checks (COACH_ATTENDANCE_REFACTOR_PLAN.md §6 Stage 4, RISK 1), DB-verified.
//  a) billable -> non-billable on an INVOICED lesson: credit_notes +1, ONE credit-note-emails request
//  b) first save on a lesson with NO session row: exactly one lesson_sessions row; attendance attaches to it
//  c) a no-change re-save: credit_notes +0, ZERO credit-note-emails requests (the guard)
// Run (imports the drivers' lib.mjs, so copy it into the drivers dir first):
//   supabase db reset && docker restart supabase_kong_SwimSync   (or run-all-drivers' own reset)
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -Atq < docs/refactor/coach-attendance-handchecks.sql
//   cp docs/refactor/coach-attendance-handchecks.mjs .claude/skills/run-ui-playwright/drivers/zz-hc.mjs
//   (cd .claude/skills/run-ui-playwright/drivers && node zz-hc.mjs) ; rm .claude/skills/run-ui-playwright/drivers/zz-hc.mjs
// 11/11 on the pre-refactor code AND after Stage 4, 2026-09-22; proven able to fail (the
// credit-note guard forced `true ||` turns (c) red). The skeleton for BACKLOG's coach
// credit-note driver. ⚠ The deep link lands on Schedule with this screen mounted HIDDEN
// beneath (§7.254) — every press here is a DOM click on the hidden screen, by design.
import { execSync } from "node:child_process";
import { launch, loginExpo, gotoAuthed, EXPO } from "./lib.mjs";
const LABEL = process.argv[2] ?? "run";
const sql = (q) => execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -Atc "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const D = sql(`select ((now() at time zone 'Asia/Singapore')::date - 7)::text`);
const C1 = "e9000000-0000-0000-0000-0000000000c1", C2 = "e9000000-0000-0000-0000-0000000000c2";
const results = []; const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + d}`); };
const { browser, page } = await launch();
let cnReq = 0; page.on("request", (r) => { if (r.url().includes("/functions/v1/credit-note-emails")) cnReq++; });
const up = (loc) => loc.evaluate((n) => { let e = n; while (e && e.getAttribute?.("tabindex") !== "0") e = e.parentElement; (e ?? n).click(); });
// click the status button `label` inside the card that names `student`
const setStatus = (student, label) => page.evaluate(([student, label]) => {
  const cards = [...document.querySelectorAll("div")].filter((d) => d.innerText?.startsWith?.(student.charAt(0)) && d.innerText.includes(student) && d.innerText.includes("Absent"));
  const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
  const leaf = [...card.querySelectorAll("div")].find((d) => d.innerText === label && d.children.length === 0);
  let e = leaf; while (e && e.getAttribute("tabindex") !== "0") e = e.parentElement; (e ?? leaf).click();
}, [student, label]);
const save = async () => {
  await up(page.getByText("Save Attendance").last());
  await page.getByText("Attendance saved.").last().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
};
try {
  await loginExpo(page, "coach@swimsync.test");
  // a)
  const cn0 = +sql(`select count(*) from credit_notes`);
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${C1}/attendance?date=${D}&from=roster`);
  await page.getByText("HC Billed Kid").last().waitFor({ timeout: 20000 });
  await setStatus("HC Billed Kid", "Absent");
  await page.waitForTimeout(500);
  await save();
  check("a) credit_notes delta = 1 after Present -> Absent on the invoiced lesson", +sql(`select count(*) from credit_notes`) - cn0 === 1);
  check("a) exactly ONE credit-note-emails request", cnReq === 1, `requests=${cnReq}`);
  check("a) DB: HC Billed Kid absent, HC Other Kid still present",
    sql(`select string_agg(s.full_name||':'||a.status, ',' order by s.full_name) from attendance a join students s on s.id=a.student_id where a.lesson_session_id='e9000000-0000-0000-0000-0000000000d1'`) === "HC Billed Kid:absent,HC Other Kid:present");
  check("a) left to the roster (from=roster)", new URL(page.url()).pathname.endsWith(`/classes/${C1}/roster`), page.url());
  // c)
  const cn1 = +sql(`select count(*) from credit_notes`); cnReq = 0;
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${C1}/attendance?date=${D}&from=roster`);
  await page.getByText("HC Billed Kid").last().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await save();
  check("c) no-change re-save: credit_notes delta = 0", +sql(`select count(*) from credit_notes`) - cn1 === 0);
  check("c) ZERO credit-note-emails requests (the guard skips it)", cnReq === 0, `requests=${cnReq}`);
  // b)
  check("b) precondition: no session row yet", sql(`select count(*) from lesson_sessions where class_id='${C2}' and session_date='${D}'`) === "0");
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${C2}/attendance?date=${D}`);
  await page.getByText("HC Fresh Kid").last().waitFor({ timeout: 20000 });
  await setStatus("HC Fresh Kid", "Present");
  await page.waitForTimeout(500);
  await save();
  const sid = sql(`select string_agg(id::text, ',') from lesson_sessions where class_id='${C2}' and session_date='${D}'`);
  check("b) exactly ONE lesson_sessions row created", sid && !sid.includes(","), sid);
  check("b) the attendance row attaches to it, status present",
    sql(`select string_agg(lesson_session_id::text||':'||status, ',') from attendance where student_id='e9000000-0000-0000-0000-00000000b001'`) === `${sid}:present`);
  check("b) left to Schedule (no from)", new URL(page.url()).pathname === "/schedule", page.url());
  check("b) audit_log attendance_saved row for the new session", sql(`select count(*) from audit_log where entity_id='${sid}' and action='attendance_saved'`) === "1");
  await page.screenshot({ path: `/tmp/claude-501/s/save-${LABEL}.png` });
} finally { await browser.close(); }
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
