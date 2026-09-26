// verify-invoice-admin.mjs — the four Invoices-page actions no other driver
// presses: the PayNow UEN / mobile save (on blur) and its 8-digit advisory,
// the run-day save and its 1–28 clamp, the CSV export (a real download, then
// the cap banner at 1000 rows), and a pending debit's Write off (Cancel, the
// blank-reason refusal, then a real reason through write_off_parent_balance).
//
// Fixture: fixtures-invoice-admin.sql   Teardown: fixtures-invoice-admin-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U6. BACKLOG item: "A verify-invoice-admin driver…".
//
// Logs in as invoice-admin-owner@swimsync.test — the owner-admin of the
// fixture's OWN business. PayNow and the run day are tenant settings the seed
// tenant's billing drivers read (plan rule 12).
//
// WHY THESE. A mistyped PayNow mobile saves clean and the parent's screen then
// shows no QR — the advisory is the only thing that says so. The run day is
// clamped to 28 because 29–31 never fire in February (and the column's CHECK
// refuses them — a save the page would swallow). The CSV cap refuses an export
// of a capped list, because a truncated file SUMS WRONG with no warning. Write
// off forgives money: a blank reason must be refused, and the write must land
// as the RPC's effects (debit 0, the application stamped, an audit row) —
// asserted in the DATABASE, before and after (plan rule 5).
//
// THE CAP WITHOUT 1000 ROWS (plan U6 ✎ / RISK 5). The invoices list GET is
// page.route'd — method GET, only the list query (it embeds invoice_items and
// orders by generated_at), hit-counted, unrouted straight after — and fulfilled
// with the REAL response's rows repeated to 1000 with distinct ids. The page's
// own exportCsv then refuses on `sourceCount >= CSV_DEFAULT_CAP`. Zero DB footprint.
//
// Dialogs: Write off is a window.prompt. launch() auto-accepts every dialog
// (lib.mjs), so its listener is removed first and each prompt is answered by
// a once-handler that records the message (rule 8). No screen here buckets by
// time of day, so no clock pin (rule 13). Every Supabase call is held to
// http://127.0.0.1:54321; anything else is ABORTED and fails the run (rule 14).
//
// RE-RUN: re-load the fixture first (it RESETS every write this driver makes).
// A re-run on a dirty DB fails on its first PRECONDITION, by design (rule 5).
//
// MUTATION PROOFS (§7.25) — each made on app code, run, seen red, reverted
// (`git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean after):
//
//   | # | mutation                                                   | result | red checks |
//   |---|------------------------------------------------------------|--------|------------|
//   | 1 | invoices/domain/paynow.ts:20 → `/^\d{7,8}$/` (a 7-digit mobile passes) | 30/31 | "⚠ …but warns it isn't 8 digits, so no QR can be built" (read "PayNow details saved.") |
//   | 2 | invoices/domain/useTenantBilling.ts:87 → `Math.min(31, …)` | 30/31 | "⚠ run day 31 is clamped to 28 and saved" (DB still 7, input 31 — the column's CHECK 1..28 refused the write and the page said nothing) |
//
// (2026-09-26, both reverted; `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean. Each mutation's
// arrival was grepped in the served chunk `/_next/static/chunks/app/(admin)/invoices/page.js` as the
// changed CODE (`d{7,8}`, `Math.min(31, Math.max`), and its absence re-grepped after the revert.)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { launch, loginAdmin, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
const API = "http://127.0.0.1:54321";
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

const TENANT = "d3000000-0000-0000-0000-000000000001";
const OWNER = "d3000000-0000-0000-0000-0000000000a1";
const APPLICATION = "d3000000-0000-0000-0000-0000000002b1";
const LEAVER = sql(`SELECT id FROM parents WHERE profile_id='d3000000-0000-0000-0000-0000000000f1'`);
if (!LEAVER) throw new Error("fixture not loaded — load fixtures-invoice-admin.sql first");
const REFS = "INV-IA-0001,INV-IA-0002,INV-IA-0003";
// The three rows as the table renders them (months from the DB, §7.225).
const MONTHS = sql(`SELECT string_agg(to_char(to_date(billing_month,'YYYY-MM'),'Mon YYYY'), ',' ORDER BY reference_number)
                      FROM invoices WHERE tenant_id='d3000000-0000-0000-0000-000000000001'`).split(",");
const ROWS = [`InvAdm Leaver|${MONTHS[0]}|Paid`, `InvAdm Leaver|${MONTHS[1]}|Paid`,
              `InvAdm Stayer|${MONTHS[2]}|Outstanding`].sort().join(",");

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
const settingsQ = `SELECT coalesce(paynow_uen,'∅')||'/'||coalesce(paynow_mobile,'∅')||'/'||invoice_run_day
                     FROM tenants WHERE id='${TENANT}'`;
const uen = page.locator("#paynow-uen");
const mobile = page.locator("#paynow-mobile");
const runDay = page.locator("#run-day");
// The one line handleSavePaynow writes (saved / saved-with-warning / error).
const payMsg = page.locator("p", { hasText: /^(PayNow details saved\.|Saved — ⚠|Error: )/ });
async function payMsgUntil(re, ms = 8000) {
  const end = Date.now() + ms;
  let v = flat(await payMsg.innerText({ timeout: 500 }).catch(() => "(no message)"));
  while (!re.test(v) && Date.now() < end) {
    await page.waitForTimeout(200);
    v = flat(await payMsg.innerText({ timeout: 500 }).catch(() => "(no message)"));
  }
  return v;
}
const exportBtn = page.getByRole("button", { name: "Export CSV" });
const capBanner = page.getByText(/^Too many invoices to export at once/);
const cappedNote = page.getByText(/^Showing the first 1000 invoices\./);
// The table shows no reference, so a row is read as "parent|month|status".
const rowSig = async () => (await page.locator("tbody tr", { hasText: "InvAdm" }).evaluateAll((trs) =>
  trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()))
    .map((c) => `${c[0]}|${c[2]}|${c[7]}`))).sort().join(",");
// Press Export CSV and report the download (or its absence) within `ms`.
async function exportAndCatch(ms = 4000) {
  const dl = page.waitForEvent("download", { timeout: ms }).catch(() => null);
  await exportBtn.click();
  const d = await dl;
  if (!d) return null;
  const p = await d.path();
  return { name: d.suggestedFilename(), body: p ? readFileSync(p, "utf8") : "" };
}

try {
  await loginAdmin(page, "invoice-admin-owner@swimsync.test");
  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.getByText("InvAdm Stayerkid").first().waitFor();
  // The inputs are disabled until loadTenant resolves.
  await runDay.and(page.locator(":enabled")).waitFor();

  // ══ 1. PayNow — saved on blur, advisory only ═══════════════════════════════
  check("PRECONDITION: no PayNow proxy, run day 7", sql(settingsQ) === "∅/∅/7", sql(settingsQ));
  check("PRECONDITION: the inputs read the tenant's values (blank, blank, 7)",
    (await uen.inputValue()) === "" && (await mobile.inputValue()) === "" && (await runDay.inputValue()) === "7",
    `${await uen.inputValue()}|${await mobile.inputValue()}|${await runDay.inputValue()}`);

  await uen.fill("201403121W");
  await uen.blur();
  const uenSaved = await dbUntil(settingsQ, (v) => v.startsWith("201403121W/"));
  check("UEN saves on blur", uenSaved === "201403121W/∅/7", uenSaved);
  check("…and says so", (await payMsgUntil(/^PayNow details saved\.$/)) === "PayNow details saved.");

  await mobile.fill("9123456");
  await mobile.blur();
  const shortSaved = await dbUntil(settingsQ, (v) => v.includes("/9123456/"));
  check("a 7-digit mobile STILL saves (advisory, never a blocked save)",
    shortSaved === "201403121W/9123456/7", shortSaved);
  const warn = await payMsgUntil(/^Saved — ⚠/);
  check("⚠ …but warns it isn't 8 digits, so no QR can be built",
    warn === "Saved — ⚠ That mobile number isn't 8 digits, so a payment QR can't be built from it — parents will see no QR until it's fixed.",
    warn);

  await mobile.fill("+65 9123 4567");
  await mobile.blur();
  const normSaved = await dbUntil(settingsQ, (v) => v.includes("/91234567/"));
  check("a +65-prefixed, spaced mobile is stored as the bare 8 digits",
    normSaved === "201403121W/91234567/7", normSaved);
  const okAgain = await payMsgUntil(/^PayNow details saved\.$/);
  check("…the warning clears, and the input shows the stored form",
    okAgain === "PayNow details saved." && (await mobile.inputValue()) === "91234567",
    `${okAgain} · input ${await mobile.inputValue()}`);

  await page.reload({ waitUntil: "networkidle" });
  await runDay.and(page.locator(":enabled")).waitFor();
  check("a reload reads both back from the tenant",
    (await uen.inputValue()) === "201403121W" && (await mobile.inputValue()) === "91234567",
    `${await uen.inputValue()}|${await mobile.inputValue()}`);

  await uen.fill("");
  await uen.blur();
  const cleared = await dbUntil(settingsQ, (v) => v.startsWith("∅/"));
  check("clearing the UEN stores NULL (and is not warned about)",
    cleared === "∅/91234567/7" && (await payMsgUntil(/^PayNow details saved\.$/)) === "PayNow details saved.",
    cleared);

  // ══ 2. Run day — saved on blur, clamped 1–28 ═══════════════════════════════
  await runDay.fill("31");
  await runDay.blur();
  const clampHi = await dbUntil(settingsQ, (v) => !v.endsWith("/7"));
  await page.waitForTimeout(300);
  check("⚠ run day 31 is clamped to 28 and saved", clampHi === "∅/91234567/28" &&
    (await runDay.inputValue()) === "28", `DB ${clampHi} · input ${await runDay.inputValue()}`);

  await runDay.fill("0");
  await runDay.blur();
  const clampLo = await dbUntil(settingsQ, (v) => v.endsWith("/1"));
  await page.waitForTimeout(300);
  check("run day 0 is clamped to 1 and saved", clampLo === "∅/91234567/1" &&
    (await runDay.inputValue()) === "1", `DB ${clampLo} · input ${await runDay.inputValue()}`);

  await runDay.fill("15");
  await runDay.blur();
  const day15 = await dbUntil(settingsQ, (v) => v.endsWith("/15"));
  const runsFrom = await page.getByText("Runs from day 15 for the previous month")
    .waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  check("run day 15 saves, and the schedule line says so", day15 === "∅/91234567/15" && runsFrom,
    `DB ${day15} · line ${runsFrom}`);

  // ══ 3. CSV export — a real download, then the cap ══════════════════════════
  const invCountQ = `SELECT count(*) FROM invoices WHERE tenant_id='${TENANT}'`;
  check("PRECONDITION: the list shows this business's three invoices, uncapped",
    (await rowSig()) === ROWS && !(await cappedNote.isVisible()) && sql(invCountQ) === "3",
    `${await rowSig()} · DB ${sql(invCountQ)}`);

  const file = await exportAndCatch();
  const fileRefs = [...new Set((file?.body ?? "").match(/INV-IA-\d{4}/g) ?? [])].sort().join(",");
  check("Export CSV downloads the visible rows (header + all three references)",
    !!file && /^﻿?Parent,Students,Month,Gross,Package,Credit,Adjustment,Net,Status,Parent says paid,Reference/.test(file.body) &&
      fileRefs === REFS && /^invoices-\d{4}-\d{2}-\d{2}\.csv$/.test(file.name),
    file ? `${file.name} · ${fileRefs}` : "(no download)");
  check("…with no cap banner", !(await capBanner.isVisible()));

  // The list GET, fulfilled with the real rows repeated to 1000 (distinct ids).
  let hits = 0;
  const isListGet = (url) => {
    const u = new URL(url);
    return u.origin === API && u.pathname === "/rest/v1/invoices" && (u.searchParams.get("select") ?? "").includes("invoice_items(") &&
      u.searchParams.get("order") === "generated_at.desc";
  };
  const handler = async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    hits++;
    const real = await route.fetch();
    const rows = await real.json();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`list GET returned ${JSON.stringify(rows).slice(0, 80)}`);
    const many = Array.from({ length: 1000 }, (_, i) => ({
      ...rows[i % rows.length],
      id: `d3000000-0000-0000-0000-${(0x900000000000 + i).toString(16)}`,
    }));
    return route.fulfill({ response: real, json: many });
  };
  await page.route(isListGet, handler);
  // Re-scoping the search re-runs load() exactly once — no page reload.
  await page.getByLabel("Search by").selectOption("student");
  const cappedShown = await cappedNote.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("the 1000-row list lands (the page's own 'Showing the first 1000' note)", cappedShown && hits === 1,
    `note ${cappedShown} · route hits ${hits}`);

  const refused = await exportAndCatch(2500);
  const banner = flat(await capBanner.innerText({ timeout: 3000 }).catch(() => "(no banner)"));
  check("⚠ Export CSV at the cap is REFUSED — no download, and the banner says why",
    refused === null && banner === "Too many invoices to export at once (the list is capped at 1000). " +
      "Narrow it with the status filter, search, or a month, then export again.",
    `${refused ? `DOWNLOADED ${refused.name}` : "no download"} · ${banner}`);
  await page.unroute(isListGet, handler);
  check("the route matched exactly the one list GET", hits === 1, `hits ${hits}`);

  await page.getByLabel("Search by").selectOption("parent");
  // Wait for the REAL three rows, not for the note to hide: load() sets
  // loading=true first, which hides the note while the 1000 rows still stand
  // — an Export pressed then is (rightly) refused.
  const endReal = Date.now() + 10000;
  while ((await rowSig()) !== ROWS && Date.now() < endReal) await page.waitForTimeout(250);
  const uncapped = (await rowSig()) === ROWS && !(await cappedNote.isVisible());
  const again = await exportAndCatch();
  check("back on the real list, Export downloads again and the banner clears",
    uncapped && !!again && !(await capBanner.isVisible()) && (await rowSig()) === ROWS,
    `uncapped ${uncapped} · ${again ? again.name : "(no download)"} · rows ${await rowSig()}`);
  check("the export wrote nothing (invoices still 3)", sql(invCountQ) === "3", sql(invCountQ));

  // ══ 4. Write off a pending debit ═══════════════════════════════════════════
  const debitQ = `SELECT debit_balance FROM parent_tenant_balances WHERE parent_id='${LEAVER}' AND tenant_id='${TENANT}'`;
  const appQ = `SELECT (written_off_at IS NOT NULL)||'|'||coalesce(written_off_by::text,'-')
                  FROM credit_applications WHERE id='${APPLICATION}'`;
  const auditQ = `SELECT count(*) FROM audit_log WHERE tenant_id='${TENANT}' AND action='parent_debit_written_off'`;
  const untouched = () => sql(debitQ) === "40.00" && sql(appQ) === "false|-" && sql(auditQ) === "0";
  const dbState = () => `debit ${sql(debitQ)} · app ${sql(appQ)} · audit ${sql(auditQ)}`;
  check("PRECONDITION: the leaver owes S$40.00, the debited application is open, no write-off audited",
    untouched(), dbState());

  const debits = page.getByTestId("pending-debits");
  const leaverLine = debits.locator("li", { hasText: "InvAdm Leaver" });
  const lineText = flat(await leaverLine.innerText().catch(() => "(no line)"));
  check("Pending charges lists the leaver's S$40.00", /^InvAdm Leaver\s*owes S\$40\.00\s*Write off$/.test(lineText), lineText);

  page.removeAllListeners("dialog");
  const answer = (how) => new Promise((resolve) => {
    page.once("dialog", async (d) => {
      const msg = d.message();
      if (how === null) await d.dismiss(); else await d.accept(how);
      resolve(msg);
    });
  });
  const errLine = page.getByTestId("pending-debit-error");

  // Cancel the prompt.
  let asked = answer(null);
  await leaverLine.getByRole("button", { name: "Write off" }).click();
  let msg = await Promise.race([asked, page.waitForTimeout(5000).then(() => "(no dialog)")]);
  await page.waitForTimeout(1000);
  check("Cancel on the prompt: it asked about S$40.00, and nothing changed",
    /^Write off S\$40\.00 owed by InvAdm Leaver\?/.test(msg) && /Enter a reason for the record:$/.test(msg) &&
      untouched() && !(await errLine.isVisible()),
    `${flat(msg).slice(0, 60)} · ${dbState()}`);

  // A blank reason.
  asked = answer("   ");
  await leaverLine.getByRole("button", { name: "Write off" }).click();
  msg = await Promise.race([asked, page.waitForTimeout(5000).then(() => "(no dialog)")]);
  const refusal = flat(await errLine.innerText({ timeout: 5000 }).catch(() => "(no error)"));
  await page.waitForTimeout(1000);
  check("⚠ a BLANK reason is refused by name, and the balance is untouched",
    /^Write off S\$40\.00/.test(msg) && refusal === "A reason is required to write off a balance." && untouched(),
    `${refusal} · ${dbState()}`);

  // A real reason.
  asked = answer("InvAdm leaving — collected by PayNow");
  await leaverLine.getByRole("button", { name: "Write off" }).click();
  msg = await Promise.race([asked, page.waitForTimeout(5000).then(() => "(no dialog)")]);
  const zeroed = await dbUntil(debitQ, (v) => v === "0.00");
  check("⚠ a real reason writes it off: debit_balance 0.00", zeroed === "0.00", `${flat(msg).slice(0, 40)} · debit ${zeroed}`);
  check("…the debited application is stamped written-off BY this admin", sql(appQ) === `true|${OWNER}`, sql(appQ));
  const audit = sql(`SELECT actor_id||'|'||entity_id||'|'||(new_value->>'reason')||'|'||(new_value->>'amount')
                       FROM audit_log WHERE tenant_id='${TENANT}' AND action='parent_debit_written_off'`);
  check("…and ONE audit row records who, which family, the trimmed reason and the amount",
    audit === `${OWNER}|${LEAVER}|InvAdm leaving — collected by PayNow|40.00`, audit);
  const gone = await debits.waitFor({ state: "detached", timeout: 8000 }).then(() => true).catch(() => false);
  check("the Pending charges section empties, and the refusal clears", gone && !(await errLine.isVisible()),
    `section gone ${gone} · error visible ${await errLine.isVisible()}`);

  // ══ 5. Run-wide guards ═════════════════════════════════════════════════════
  check("every Supabase call went to the local stack", offLocal.length === 0 && localApiCalls > 0,
    `local ${localApiCalls} · off-local ${offLocal.slice(0, 2).join(", ")}`);
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || ").slice(0, 200));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/invoice-admin-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
