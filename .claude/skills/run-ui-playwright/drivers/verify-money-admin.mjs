// verify-money-admin.mjs — the admin money actions no other driver presses:
// Credit Notes (Void — the drawn-note warning, Cancel, the blank-reason
// refusal, the confirmed void that REOPENS the drawn invoice; the scoped
// Student / Parent / Reference search; the status filter; Export CSV),
// Referrals (Save settings, Disable / Enable a family code, Grant a reward,
// Void a reward through its window.prompt — dismissed, then answered), and
// Wages (the rain-pays toggle, the pay-day clamp to 1–28, the Shadow-rate
// re-prefill saved WITHOUT retyping the amount, a payout's breakdown expand).
//
// Fixture: fixtures-money-admin.sql   Teardown: fixtures-money-admin-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U4. BACKLOG item: "A verify-money-admin driver…".
//
// Logs in as money-admin-owner@swimsync.test — the owner-admin of the
// fixture's OWN business. The rain toggle, the pay day and the referral
// programme are TENANT settings the seed tenant's drivers read (plan rule 12).
//
// WHY THESE. Void on a DRAWN credit note reopens the invoice it was spent on
// (credit_applied back to 0, net back up) — asserted on the invoice row, not
// the badge. The Shadow re-prefill is what stops a trainee being saved at the
// full teaching rate: the check selects Shadow and saves WITHOUT retyping the
// amount, the only path on which the prefill decides what is written. Every
// write is a before/after pair on a query scoped to the fixture's ids (rule 5).
//
// NEVER PRESSES RESEND. CN-MA-0002 is deliberately un-emailed, so a Resend
// button sits on the page; every request is watched and the run fails on ANY
// call to /functions/v1/credit-note-emails (plan ⚠ RISK 7). Every Supabase
// call is also held to http://127.0.0.1:54321 — anything else is ABORTED
// before it leaves the browser and fails the run (rule 14).
//
// Referrals' Void is a window.prompt; launch() auto-accepts dialogs, so the
// listener is removed and each prompt answered here, and the dismissed prompt
// is paired with a DB-unchanged assert (rule 8, §7.279). Credit Notes' Cancel
// is an inline button — also paired with a DB-unchanged assert.
//
// No screen here buckets by time of day, so no clock pin (rule 13). Months and
// "today" come from the DB, never JS local time (§7.7, rule 4).
//
// RE-RUN: re-load the fixture first (it RESETS every write this driver makes).
// A re-run on a dirty DB fails on its first PRECONDITION, by design (rule 5).
//
// MUTATION PROOFS (§7.25) — each made on app code, run, seen red, reverted
// (`git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean after):
//
//   | # | mutation                                                              | result | red checks |
//   |---|-----------------------------------------------------------------------|--------|------------|
//   | 1 | wages/ui/RatesCard.tsx:87 → delete `setRateAmount(r ? String(r.amount) : "")` | 42/44 | "switching to Shadow re-prefills the SHADOW rate (15)" (field kept 40), "⚠ Save writes role=shadow at the SHADOW amount" (DB 40.00/60 — a trainee saved at the teaching rate) |
//   | 2 | credit-notes/domain/useCreditNoteList.ts:92 → the SECOND `===` (`label === statusFilter`) → `label !== statusFilter` | 41/44 | "⚠ the Available filter shows ONLY the available note", "the Applied filter…", "the Reversed filter…" (each showed the OTHER note) |
//
// (2026-09-26, both reverted; `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean. The plan
// cites `:93` for mutation 2 — the line is `:92` at 3acd04b.)

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

const EXPECTED_CHECKS = 44;

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

const TENANT = "c4000000-0000-0000-0000-000000000001";
const OWNER = "c4000000-0000-0000-0000-0000000000a1";
const NOTE_DRAWN = "c4000000-0000-0000-0000-0000000002a1";
const NOTE_AVAIL = "c4000000-0000-0000-0000-0000000002a2";
const APPLICATION = "c4000000-0000-0000-0000-0000000002b1";
const DRAWN_INVOICE = "c4000000-0000-0000-0000-0000000000b3";
const FRIEND_REWARD = "c4000000-0000-0000-0000-0000000004b1";
const P1 = sql(`SELECT id FROM parents WHERE profile_id='c4000000-0000-0000-0000-0000000000f1'`);
const P2 = sql(`SELECT id FROM parents WHERE profile_id='c4000000-0000-0000-0000-0000000000f2'`);
const COACH = sql(`SELECT id FROM coaches WHERE profile_id='c4000000-0000-0000-0000-0000000000a2'`);
if (!P1 || !P2 || !COACH) throw new Error("fixture not loaded — load fixtures-money-admin.sql first");
const TODAY = sql(`SELECT (now() AT TIME ZONE 'Asia/Singapore')::date`);
const LAST_MONTH = sql(`SELECT to_char(session_date,'YYYY-MM') FROM lesson_sessions
                         WHERE id='c4000000-0000-0000-0000-0000000000e1'`);

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
// The Modal primitive has no role; its overlay is the fixed z-50 layer.
const modal = (page) => page.locator("div.fixed.inset-0.z-50").last();

const { browser, ctx, page } = await launch({ headless: true });
page.setDefaultTimeout(15000);
if (process.env.SHOT_DIR) console.log("shots:", process.env.SHOT_DIR);

// ── Network guards over the WHOLE run ───────────────────────────────────────
const offLocal = [];
let localApiCalls = 0;
await ctx.route(/\/(rest|auth|functions|storage)\/v1\//, (route) => {
  const origin = new URL(route.request().url()).origin;
  if (origin !== API) { offLocal.push(route.request().url()); return route.abort(); }
  localApiCalls++;
  return route.continue();
});
const resendCalls = [];
const noteQueries = [];
page.on("request", (r) => {
  if (r.url().includes("/functions/v1/credit-note-emails")) resendCalls.push(r.postData() ?? "");
  if (r.method() === "GET" && r.url().includes("/rest/v1/credit_notes")) noteQueries.push(decodeURIComponent(r.url()));
});
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// The CN- references on the credit-notes table right now, sorted.
const refsNow = async () =>
  [...new Set(((await page.locator("tbody").first().innerText().catch(() => "")).match(/CN-MA-\d{4}/g) ?? []))]
    .sort().join(",");
async function refsUntil(want, ms = 8000) {
  const end = Date.now() + ms;
  let v = await refsNow();
  while (v !== want && Date.now() < end) { await page.waitForTimeout(250); v = await refsNow(); }
  return v;
}

try {
  await loginAdmin(page, "money-admin-owner@swimsync.test");

  // ══ 1. Credit Notes ════════════════════════════════════════════════════════
  await page.goto(`${ADMIN}/credit-notes`, { waitUntil: "networkidle" });
  // The DB half matters on a re-run: a previous run's void leaves both rows listed.
  const statusesQ = `SELECT string_agg(reference_number||':'||status, ',' ORDER BY reference_number)
                       FROM credit_notes WHERE tenant_id='${TENANT}'`;
  check("PRECONDITION: the list shows exactly the fixture's two notes, CN-MA-0001 applied and CN-MA-0002 available",
    (await refsUntil("CN-MA-0001,CN-MA-0002")) === "CN-MA-0001,CN-MA-0002" &&
      sql(statusesQ) === "CN-MA-0001:applied,CN-MA-0002:available",
    `${await refsNow()} · ${sql(statusesQ)}`);

  // Scoped search — pushed into the DB query, per column.
  const searchBy = page.getByLabel("Search by");
  const searchBox = page.getByPlaceholder(/^Search (student name|parent name|reference)…$/);
  await searchBox.fill("Availkid");
  const byStudent = await refsUntil("CN-MA-0002");
  check("Student search narrows to that child's note, IN the DB query (student_name=ilike)",
    byStudent === "CN-MA-0002" && noteQueries.some((u) => /student_name=ilike\.[^&]*Availkid/.test(u)),
    `${byStudent} · query seen ${noteQueries.some((u) => u.includes("student_name=ilike"))}`);
  await searchBy.selectOption("parent");
  await searchBox.fill("Parent One");
  const byParent = await refsUntil("CN-MA-0001");
  check("Parent search narrows to that family's note", byParent === "CN-MA-0001", byParent);
  await searchBy.selectOption("reference");
  await searchBox.fill("MA-0002");
  const byRef = await refsUntil("CN-MA-0002");
  check("Reference search narrows to that note", byRef === "CN-MA-0002", byRef);
  await searchBox.fill("");
  await refsUntil("CN-MA-0001,CN-MA-0002");

  // Status filter — refines the fetched set client-side.
  const filterBtn = (name) => page.getByRole("button", { name, exact: true });
  await filterBtn("Available").click();
  const avail = await refsUntil("CN-MA-0002");
  check("⚠ the Available filter shows ONLY the available note", avail === "CN-MA-0002", avail);
  await filterBtn("Applied").click();
  const applied = await refsUntil("CN-MA-0001");
  check("the Applied filter shows ONLY the drawn note", applied === "CN-MA-0001", applied);
  await filterBtn("All").click();
  check("All shows both again", (await refsUntil("CN-MA-0001,CN-MA-0002")) === "CN-MA-0001,CN-MA-0002", await refsNow());

  // Export CSV — the download event and its name only (plan).
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }).catch(() => null),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  check("Export CSV downloads credit-notes-<today SGT>.csv",
    dl?.suggestedFilename() === `credit-notes-${TODAY}.csv`, dl?.suggestedFilename() ?? "(no download)");

  // Void the DRAWN note.
  const noteQ = `SELECT status FROM credit_notes WHERE id='${NOTE_DRAWN}'`;
  const appQ = `SELECT (reversed_at IS NOT NULL)::text FROM credit_applications WHERE id='${APPLICATION}'`;
  const invQ = `SELECT credit_applied||'/'||net_amount||'/'||status FROM invoices WHERE id='${DRAWN_INVOICE}'`;
  const untouched = () => sql(noteQ) === "applied" && sql(appQ) === "false" && sql(invQ) === "40.00/20.00/outstanding";
  check("PRECONDITION: CN-MA-0001 is applied, its draw live, INV-MA-0003 at credit 40 / net 20",
    untouched(), `${sql(noteQ)} · draw reversed ${sql(appQ)} · ${sql(invQ)}`);

  const drawnRow = page.locator("tr", { hasText: "CN-MA-0001" });
  const panel = page.locator("tr", { has: page.getByPlaceholder(/Reason for voiding/) });
  await drawnRow.getByRole("button", { name: "Void", exact: true }).click();
  const warn = await panel.innerText({ timeout: 8000 }).catch(() => "(no panel)");
  check("Void on a DRAWN note warns the invoice goes OUTSTANDING again",
    /Void CN-MA-0001\?/.test(warn) && /OUTSTANDING again/.test(warn), warn.replace(/\n/g, " | ").slice(0, 200));

  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  const closed = await panel.waitFor({ state: "detached", timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  check("Cancel closes the confirm and voids nothing (DB unchanged)", closed && untouched(),
    `closed ${closed} · ${sql(noteQ)} · ${sql(invQ)}`);

  await drawnRow.getByRole("button", { name: "Void", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm void" }).click();
  const refused = await panel.getByText("A reason is required.").waitFor({ timeout: 5000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  check("Confirm with a BLANK reason is refused — \"A reason is required.\", DB unchanged",
    refused && untouched(), `refusal shown ${refused} · ${sql(noteQ)}`);

  await panel.getByPlaceholder(/Reason for voiding/).fill("MoneyAdm driver void");
  await panel.getByRole("button", { name: "Confirm void" }).click();
  const voided = await dbUntil(noteQ, (v) => v === "reversed");
  check("a reasoned Confirm voids the note (status reversed)", voided === "reversed", voided);
  check("…reverses its draw", sql(appQ) === "true", `draw reversed ${sql(appQ)}`);
  check("⚠ …and REOPENS the drawn invoice (credit 0, net 60, outstanding)",
    sql(invQ) === "0.00/60.00/outstanding", sql(invQ));
  check("…audited with the reason, by this admin",
    sql(`SELECT count(*) FROM audit_log WHERE entity_id='${NOTE_DRAWN}' AND action='credit_note_voided'
           AND actor_id='${OWNER}' AND new_value->>'reason'='MoneyAdm driver void'`) === "1");
  const rowAfter = await drawnRow.innerText().catch(() => "");
  check("the row now reads Reversed with no Void button",
    /Reversed/.test(rowAfter) && (await drawnRow.getByRole("button", { name: "Void", exact: true }).count()) === 0,
    rowAfter.replace(/\s+/g, " ").slice(0, 160));
  check("the OTHER note and its family's balance are untouched",
    sql(`SELECT status FROM credit_notes WHERE id='${NOTE_AVAIL}'`) === "available" &&
      sql(`SELECT credit_balance FROM parent_tenant_balances WHERE parent_id='${P2}' AND tenant_id='${TENANT}'`) === "40.00");
  await filterBtn("Reversed").click();
  const rev = await refsUntil("CN-MA-0001");
  check("the Reversed filter now shows the voided note", rev === "CN-MA-0001", rev);

  // ══ 2. Referrals ═══════════════════════════════════════════════════════════
  await page.goto(`${ADMIN}/referrals`, { waitUntil: "networkidle" });
  const settingsQ = `SELECT referral_enabled||'|'||coalesce(referral_discount_type,'')||'|'||
    coalesce(referral_discount_value::text,'')||'|'||coalesce(referral_reward_expiry_days::text,'')
    FROM tenants WHERE id='${TENANT}'`;
  check("PRECONDITION: programme is on, 10 percent, 30-day expiry", sql(settingsQ) === "true|percent|10.00|30", sql(settingsQ));
  const settings = page.locator("section", { hasText: "Programme settings" });
  await settings.getByRole("button", { name: "Save" }).waitFor();
  await settings.locator("select").selectOption("amount");
  await settings.locator('input[type="number"]').nth(0).fill("12");
  await settings.locator('input[type="number"]').nth(1).fill("60");
  await settings.getByRole("button", { name: "Save" }).click();
  const saved = await dbUntil(settingsQ, (v) => v === "true|amount|12.00|60");
  check("Save writes the type, value and expiry", saved === "true|amount|12.00|60", saved);

  const codes = page.locator("section", { hasText: "Family referral codes" });
  const codeQ = (p) => `SELECT (referral_code_disabled_at IS NOT NULL)::text FROM parent_tenants
                         WHERE parent_id='${p}' AND tenant_id='${TENANT}'`;
  check("PRECONDITION: both family codes are live", sql(codeQ(P1)) === "false" && sql(codeQ(P2)) === "false");
  const p1Code = codes.locator("tr", { hasText: "MoneyAdm Parent One" });
  await p1Code.getByRole("button", { name: "Disable", exact: true }).click();
  const disabled = await dbUntil(codeQ(P1), (v) => v === "true");
  const enableShown = await p1Code.getByRole("button", { name: "Enable", exact: true })
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("Disable shuts off THAT family's code (the other stays live), and offers Enable",
    disabled === "true" && sql(codeQ(P2)) === "false" && enableShown, `P1 ${disabled} · P2 ${sql(codeQ(P2))}`);
  await p1Code.getByRole("button", { name: "Enable", exact: true }).click();
  const reenabled = await dbUntil(codeQ(P1), (v) => v === "false");
  check("Enable turns it back on", reenabled === "false", reenabled);

  const manualQ = `SELECT count(*) FROM referral_rewards WHERE tenant_id='${TENANT}' AND parent_id='${P1}' AND kind='manual'`;
  check("PRECONDITION: Parent One holds no manual reward", sql(manualQ) === "0", sql(manualQ));
  await page.getByRole("button", { name: "Grant a reward" }).click();
  await modal(page).locator("select").selectOption({ label: "MoneyAdm Parent One" });
  await modal(page).getByPlaceholder("Goodwill").fill("MoneyAdm goodwill");
  await modal(page).getByRole("button", { name: "Grant", exact: true }).click();
  const granted = await dbUntil(manualQ, (v) => v === "1");
  const grantRow = sql(`SELECT status||'|'||grant_reason||'|'||granted_by||'|'||
      round(extract(epoch FROM expires_at - earned_at)/86400) FROM referral_rewards
      WHERE tenant_id='${TENANT}' AND parent_id='${P1}' AND kind='manual'`);
  check("Grant writes an available manual reward, with the reason, by this admin, on the NEW 60-day expiry",
    granted === "1" && grantRow === `available|MoneyAdm goodwill|${OWNER}|60`, grantRow || `count ${granted}`);

  const rewardQ = `SELECT status||'|'||coalesce(void_reason,'') FROM referral_rewards WHERE id='${FRIEND_REWARD}'`;
  check("PRECONDITION: Parent Two's friend's-first reward is available", sql(rewardQ) === "available|", sql(rewardQ));
  const rewards = page.locator("section", { hasText: "Beneficiary" });
  const p2Reward = rewards.locator("tr", { hasText: "MoneyAdm Parent Two" });
  page.removeAllListeners("dialog"); // launch() auto-ACCEPTS; answer each prompt here (§7.279)
  const answer = (reply) => new Promise((resolve) => page.once("dialog", async (d) => {
    const msg = `${d.type()}: ${d.message()}`;
    if (reply === null) await d.dismiss(); else await d.accept(reply);
    resolve(msg);
  }));
  let asked = answer(null);
  await p2Reward.getByRole("button", { name: "Void", exact: true }).click();
  const dismissedMsg = await Promise.race([asked, page.waitForTimeout(5000).then(() => "(no dialog)")]);
  await page.waitForTimeout(1000);
  check("Void asks for a reason (a prompt); dismissing it voids nothing (DB unchanged)",
    dismissedMsg === "prompt: Reason for voiding this reward?" && sql(rewardQ) === "available|",
    `${dismissedMsg} · ${sql(rewardQ)}`);
  asked = answer("MoneyAdm driver void");
  await p2Reward.getByRole("button", { name: "Void", exact: true }).click();
  await Promise.race([asked, page.waitForTimeout(5000)]);
  const rewardVoided = await dbUntil(rewardQ, (v) => v.startsWith("void"));
  check("answering the prompt voids the reward with that reason, by this admin",
    rewardVoided === "void|MoneyAdm driver void" &&
      sql(`SELECT voided_by FROM referral_rewards WHERE id='${FRIEND_REWARD}'`) === OWNER, rewardVoided);

  // ══ 3. Wages ═══════════════════════════════════════════════════════════════
  await page.goto(`${ADMIN}/wages`, { waitUntil: "networkidle" });
  const policyQ = `SELECT rain_pays_coach||'|'||wage_run_day FROM tenants WHERE id='${TENANT}'`;
  check("PRECONDITION: rain does not pay, pay day 15", sql(policyQ) === "false|15", sql(policyQ));
  const rain = page.getByLabel("Pay coaches for lessons cancelled by rain");
  await page.getByText("MoneyAdm Coach").first().waitFor(); // the tenant + policy have loaded
  await rain.click();
  const rainOn = await dbUntil(policyQ, (v) => v.startsWith("true"));
  check("ticking rain-pays saves it ON", rainOn === "true|15", rainOn);
  await rain.click();
  const rainOff = await dbUntil(policyQ, (v) => v.startsWith("false"));
  check("unticking saves it OFF", rainOff === "false|15", rainOff);

  const payDay = page.locator('label:has-text("Pay coaches on day") input');
  await payDay.fill("40");
  await payDay.press("Tab");
  const high = await dbUntil(policyQ, (v) => v === "false|28");
  check("pay day 40 CLAMPS to 28 (field and DB)", high === "false|28" && (await payDay.inputValue()) === "28",
    `${high} · field ${await payDay.inputValue()}`);
  await payDay.fill("0");
  await payDay.press("Tab");
  const low = await dbUntil(policyQ, (v) => v === "false|1");
  check("pay day 0 CLAMPS to 1 (field and DB)", low === "false|1" && (await payDay.inputValue()) === "1",
    `${low} · field ${await payDay.inputValue()}`);

  // The Shadow re-prefill — saved WITHOUT retyping the amount.
  const shadowQ = `SELECT amount||'/'||unit_minutes FROM coach_rates
                    WHERE coach_id='${COACH}' AND role='shadow' AND effective_from='${TODAY}'`;
  check("PRECONDITION: no shadow rate dated today", sql(shadowQ) === "", sql(shadowQ));
  const rateRow = page.locator("tr", { hasText: "MoneyAdm Coach" });
  await rateRow.getByRole("button", { name: "Change rate" }).click();
  const amount = rateRow.getByPlaceholder("30.00");
  check("the editor opens on the TEACHING rate (40)", (await amount.inputValue()) === "40", await amount.inputValue());
  await rateRow.locator("select").selectOption("shadow");
  check("switching to Shadow re-prefills the SHADOW rate (15)", (await amount.inputValue()) === "15",
    await amount.inputValue());
  await rateRow.locator('input[type="date"]').fill(TODAY);
  await rateRow.getByRole("button", { name: "Save", exact: true }).click();
  const shadowSaved = await dbUntil(shadowQ, (v) => v !== "");
  check("⚠ Save writes role=shadow at the SHADOW amount (15.00/60), not the teaching 40",
    shadowSaved === "15.00/60", shadowSaved || "(no row)");

  // The payout breakdown, for LAST month's attended lesson.
  const payoutQ = `SELECT cp.status||'|'||cp.gross_amount||'|'||count(i.id) FROM coach_payouts cp
                     LEFT JOIN coach_payout_items i ON i.payout_id = cp.id
                    WHERE cp.tenant_id='${TENANT}' AND cp.coach_id='${COACH}' AND cp.period_month='${LAST_MONTH}'
                    GROUP BY cp.id`;
  check("PRECONDITION: no payout for last month", sql(payoutQ) === "", sql(payoutQ));
  await page.locator('input[type="month"]').fill(LAST_MONTH);
  await page.getByRole("button", { name: "Calculate payroll" }).click();
  const payout = await dbUntil(payoutQ, (v) => v !== "");
  check("Calculate payroll drafts one S$40 payout with one lesson line", payout === "draft|40.00|1", payout || "(none)");
  const coachBtn = page.getByRole("button", { name: "MoneyAdm Coach", exact: true });
  await page.getByText("Payroll calculated.").waitFor({ timeout: 10000 }).catch(() => {});
  await coachBtn.click();
  const breakdown = page.locator('td[colspan="5"]');
  const bdText = await breakdown.innerText({ timeout: 8000 }).catch(() => "(no breakdown)");
  check("expanding the coach's payout shows the lesson line (class, S$40.00)",
    (await coachBtn.getAttribute("aria-expanded")) === "true" && /MoneyAdm Squad/.test(bdText) && /S\$40\.00/.test(bdText),
    bdText.replace(/\s+/g, " ").slice(0, 160));

  // ══ 4. Run-wide guards ═════════════════════════════════════════════════════
  check("⚠ Resend was NEVER pressed (0 calls to credit-note-emails)", resendCalls.length === 0,
    resendCalls.join(" || ").slice(0, 160));
  check("every Supabase call went to the local stack", offLocal.length === 0 && localApiCalls > 0,
    `local ${localApiCalls} · off-local ${offLocal.slice(0, 2).join(", ")}`);
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || ").slice(0, 200));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/money-admin-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
