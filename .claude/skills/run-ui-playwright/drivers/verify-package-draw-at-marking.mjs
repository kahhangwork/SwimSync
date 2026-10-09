// clock: pinnable
// Wave 6 — package lessons draw AT MARKING (docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md §1.5).
//
// pgTAP owns the ledger rules (draw, return, PK001, PK002, the matcher); this proves what only the real
// screens can:
//   1. the coach marks a package child present → the parent's "lessons remaining" AND the stored balance drop
//      by one lesson; flipping it absent gives both back;
//   2. a backdated package confirmed by the admin → the "Lessons already marked" dialog lists them → Draw
//      from package draws them (count shown, Held table moves); Keep as ad-hoc draws nothing;
//   3. the out-of-order guard: marking a later lesson while an earlier one would go unfunded is refused with
//      the DB's PK001 sentence VERBATIM on the coach's screen, and nothing is saved; the earlier lesson saves;
//   4. the parent's Packages tab lists what the package paid for, a returned lesson struck through and
//      labelled; another family can read none of it (R12 — through the screen AND the RPC itself);
//   5. Billing months reads "Nothing to bill" for an ended, fully marked, fully drawn month.
//
// Prereqs: Wave 6 migrations A + B applied (the fixture refuses to load otherwise), admin + Expo dev servers,
// then:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-package-draw-at-marking.sql
//   node .claude/skills/run-ui-playwright/drivers/verify-package-draw-at-marking.mjs
// Every date is read from the rows the fixture wrote; labels come from lib.mjs (§7.302).
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { loginAdmin, loginExpo, tap, gotoAuthed, pressByText, dumpText, launch, ADMIN, EXPO } from "./lib.mjs";

const sql = (q) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -tAc ${JSON.stringify(q.replace(/\s+/g, " ").trim())}`,
    { encoding: "utf8" }).trim();

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (name) => path.join(SHOT, `w6pd-${name}.png`);

const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
/** One section: a failed click or wait becomes that section's FAIL, never an abort (§7.322). */
async function section(name, fn) {
  console.log(`\n── ${name}`);
  try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e.message ?? e).split("\n")[0]); }
}

// ── What the fixture wrote ───────────────────────────────────────────────────────────────────────────────
const ID = (tail) => `e6d00000-0000-0000-0000-${tail}`;
const PKG = { ava: ID("00000000e0a0"), ben: ID("00000000e0b0"), cara: ID("00000000e0c0"), dan: ID("00000000e0d0") };
const CLS = { draw: ID("00000000c1a0"), guard: ID("00000000c1d0") };
const KID = { ava: ID("0000000005a0"), dan: ID("0000000005d0") };
const [T, M1] = sql(`SELECT to_char(app_today(), 'YYYY-MM-DD')
  || '|' || to_char(date_trunc('month', app_now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month', 'YYYY-MM')`).split("|");
const minus = (iso, k) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
const AVA_D1 = minus(T, 1);          // Ava's unmarked lesson
const DAN_EARLY = minus(T, 9);       // Dan's earlier unmarked lesson — the one PK001 names
const DAN_LATE = minus(T, 2);        // the later one the coach tries first
const BACKDATED_START = minus(T, 14);

const value = (pkg) => Number(sql(`SELECT value_remaining FROM parent_packages WHERE id = '${pkg}'`));
const liveDraws = (pkg) => Number(sql(`SELECT count(*) FROM package_applications WHERE parent_package_id = '${pkg}' AND reversed_at IS NULL`));
const markOf = (cls, kid, iso) => sql(`SELECT COALESCE((SELECT a.status::text FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
  WHERE ls.class_id = '${cls}' AND ls.session_date = '${iso}' AND a.student_id = '${kid}'), '(none)')`);

console.log(`scenario: T=${T}  Ava ${AVA_D1}  Dan ${DAN_EARLY}/${DAN_LATE}  backdated start ${BACKDATED_START}  months ${M1}`);

// lib.mjs's browser: every context this driver makes on it is pinned under --now.
// The spare context launch() opens is closed; this driver builds its own.
const { browser, ctx: spareCtx } = await launch();
await spareCtx.close();
const mobile = async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, isMobile: true, timezoneId: "Asia/Singapore" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  return page;
};
const desktop = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "Asia/Singapore" });
  return ctx.newPage();
};

/** The parent's Packages tab, freshly loaded (the live count is read on load). */
async function openPackages(page) {
  await gotoAuthed(page, `${EXPO}/`);
  await tap(page.getByText("Billing", { exact: true }).last(), "Billing tab");
  await page.waitForTimeout(2500);
  await tap(page.getByText("Packages", { exact: true }).first(), "Packages tab");
  await page.waitForTimeout(2500);
  return dumpText(page, 4000);
}
const remaining = (text) => Number(text.match(/(\d+)\s*\n?\s*lessons remaining/)?.[1] ?? NaN);

/** The coach's marking screen for one lesson: tap a status for the only child, save, return the page text. */
async function coachMark(page, cls, iso, status) {
  await gotoAuthed(page, `${EXPO}/(coach)/classes/${cls}/attendance?date=${iso}`);
  await page.waitForTimeout(1500);
  await pressByText(page, status);
  await page.waitForTimeout(600);
  await pressByText(page, "Save Attendance");
}

const parentAva = await mobile();
const coach = await mobile();
const admin = await desktop();

// ── 1. Draw on marking, return on un-marking ────────────────────────────────────────────────────────────────
await section("1. coach marks → the package draws; absent → it returns", async () => {
  await loginExpo(parentAva, "w6pd-parent-ava@swimsync.test");
  let text = await openPackages(parentAva);
  await parentAva.screenshot({ path: shot("parent-before"), fullPage: true });
  check("parent starts at 9 lessons remaining (the fixture's T−8 lesson already drew)", remaining(text) === 9, `read ${remaining(text)}`);
  check("…and the stored balance agrees (S$270)", value(PKG.ava) === 270, String(value(PKG.ava)));

  await loginExpo(coach, "w6pd-owner@swimsync.test");
  await coachMark(coach, CLS.draw, AVA_D1, "Present");
  await coach.waitForTimeout(3500);
  check("coach's present mark saved", markOf(CLS.draw, KID.ava, AVA_D1) === "present", markOf(CLS.draw, KID.ava, AVA_D1));
  const drew = value(PKG.ava) === 240;
  check("stored balance dropped by ONE lesson (270 → 240)", drew, String(value(PKG.ava)));
  text = await openPackages(parentAva);
  check("parent now reads 8 lessons remaining", remaining(text) === 8, `read ${remaining(text)}`);

  await coachMark(coach, CLS.draw, AVA_D1, "Absent");
  await coach.waitForTimeout(3500);
  check("coach's flip to absent saved", markOf(CLS.draw, KID.ava, AVA_D1) === "absent", markOf(CLS.draw, KID.ava, AVA_D1));
  // Only a return if there was a draw to return — with no draw, 270 "coming back" is vacuous.
  check("stored balance came back (240 → 270)", drew && value(PKG.ava) === 270, `drew=${drew}, now ${value(PKG.ava)}`);
  text = await openPackages(parentAva);
  await parentAva.screenshot({ path: shot("parent-after-return"), fullPage: true });
  check("parent reads 9 lessons remaining again", remaining(text) === 9, `read ${remaining(text)}`);
});

// ── 4a. The parent's usage list ─────────────────────────────────────────────────────────────────────────────
await section("4a. parent: what the package paid for", async () => {
  await tap(parentAva.getByText(/^Show lessons used/).first(), "Show lessons used");
  await parentAva.waitForTimeout(2500);
  const text = await dumpText(parentAva, 5000);
  await parentAva.screenshot({ path: shot("parent-usage"), fullPage: true });
  check("the toggle opened the list", /Hide lessons used/.test(text));
  check("the live draw is listed (Ava · W6PD Draw, S$30.00)", /Ava W6pd · W6PD Draw/.test(text) && /S\$30\.00/.test(text));
  check("the returned lesson is listed AND labelled — not hidden", /Returned to the package/.test(text));
  const struck = await parentAva.evaluate(() =>
    [...document.querySelectorAll("*")].some((e) => e.children.length === 0 && /Ava W6pd · W6PD Draw/.test(e.textContent ?? "")
      && getComputedStyle(e).textDecorationLine.includes("line-through")));
  check("…and struck through", struck);
});

// ── 3. The out-of-order guard (D6, PK001) ───────────────────────────────────────────────────────────────────
await section("3. coach: a later lesson is refused while an earlier one would go unfunded", async () => {
  const before = value(PKG.dan);
  await coachMark(coach, CLS.guard, DAN_LATE, "Present");
  // The toast is transient — poll for EITHER error line, so the one that actually showed is what gets judged
  // (reading the page afterwards found nothing once it faded, and passed a mapper that said "try again").
  const toast = await coach.waitForFunction(() => {
    const m = document.body.innerText.match(/Mark [^\n]*Nothing was saved\.|[^\n]*Please try again\.?/);
    return m ? m[0] : null;
  }, null, { timeout: 12000 }).then((h) => h.jsonValue()).catch(() => null);
  await coach.screenshot({ path: shot("coach-pk001"), fullPage: true });
  const day = Number(DAN_EARLY.slice(8, 10));
  // The DB's sentence, verbatim: the date (its day — the month NAME is Postgres's, §7.302), the count, the
  // child and the class, and that the batch rolled back.
  const verbatim = new RegExp(`^Mark ${day} \\w+ first — the package has 1 lesson left\\. \\(Dan W6pd · W6PD Guard\\) Nothing was saved\\.$`);
  check("the coach sees the DB's PK001 sentence verbatim", verbatim.test(toast ?? ""), toast ?? "(no toast)");
  check("…not the retry-forever line", toast !== null && !/Please try again/.test(toast), toast ?? "(no toast)");
  check("nothing was saved for the later lesson", markOf(CLS.guard, KID.dan, DAN_LATE) === "(none)", markOf(CLS.guard, KID.dan, DAN_LATE));
  check("…and the package was not touched", value(PKG.dan) === before, `${before} → ${value(PKG.dan)}`);

  await coachMark(coach, CLS.guard, DAN_EARLY, "Present");
  await coach.waitForTimeout(3500);
  check("the earlier lesson the message named saves", markOf(CLS.guard, KID.dan, DAN_EARLY) === "present", markOf(CLS.guard, KID.dan, DAN_EARLY));
  check("…and draws the last lesson (S$30 → S$0)", value(PKG.dan) === 0, String(value(PKG.dan)));
});

// ── 2. Backdated activation (D5) ────────────────────────────────────────────────────────────────────────────
async function confirmBackdated(parentName) {
  await admin.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  const row = admin.locator("tr", { hasText: parentName });
  await row.getByRole("button", { name: "Payment received" }).first().click();
  // The modal pre-fills a SUGGESTED start asynchronously; let it land, then set the backdated one.
  await admin.waitForTimeout(1500);
  await admin.locator('input[type="date"]').last().fill(BACKDATED_START);
  await admin.getByRole("button", { name: "Payment received" }).last().click();
  await admin.getByText("Lessons already marked").waitFor({ timeout: 15000 });
  return admin.locator("body").innerText();
}

await section("2a. admin: confirm a backdated package → Draw from package", async () => {
  await loginAdmin(admin, "w6pd-owner@swimsync.test");
  const text = await confirmBackdated("W6PD Ben Parent");
  await admin.screenshot({ path: shot("admin-backlog-dialog"), fullPage: true });
  check("the dialog asks, naming the package", /W6PD Ten.*is active/.test(text));
  check("…and lists both lessons already marked, paid by this package", /2 lessons since its start date were marked/.test(text)
    && /2 lessons from this package/.test(text));
  check("…naming the child and class", /Ben W6pd/.test(text) && /W6PD Backdate/.test(text));
  check("nothing drawn before the admin answers", liveDraws(PKG.ben) === 0, String(liveDraws(PKG.ben)));

  await admin.getByRole("button", { name: "Draw from package" }).click();
  await admin.getByTestId("backlog-drawn").waitFor({ timeout: 15000 });
  check("the dialog shows the DRAW's own count", /Drew 2 lessons/.test(await admin.getByTestId("backlog-drawn").innerText()));
  check("both lessons drawn (S$300 → S$240)", liveDraws(PKG.ben) === 2 && value(PKG.ben) === 240, `${liveDraws(PKG.ben)} draws, S$${value(PKG.ben)}`);
  await admin.getByRole("button", { name: "Close" }).click();
  await admin.waitForTimeout(2000);
  const held = await admin.locator("tr", { hasText: "W6PD Ben Parent" }).first().innerText();
  check("the Held table shows 8 lessons", /8 lessons/.test(held), held.replace(/\s+/g, " "));
});

await section("2b. admin: confirm a backdated package → Keep as ad-hoc", async () => {
  await confirmBackdated("W6PD Cara Parent");
  await admin.getByRole("button", { name: "Keep as ad-hoc" }).click();
  await admin.waitForTimeout(1500);
  check("the dialog closed", (await admin.getByText("Lessons already marked").count()) === 0);
  check("nothing drawn (S$300 stays)", liveDraws(PKG.cara) === 0 && value(PKG.cara) === 300, `${liveDraws(PKG.cara)} draws, S$${value(PKG.cara)}`);
  check("the package is active all the same", sql(`SELECT status FROM parent_packages WHERE id = '${PKG.cara}'`) === "active");
});

// ── 4b. Another family sees none of it (R12) ────────────────────────────────────────────────────────────────
await section("4b. another family's parent sees none of Ava's lessons", async () => {
  const other = await mobile();
  await loginExpo(other, "w6pd-parent-ben@swimsync.test");
  await openPackages(other);
  await tap(other.getByText(/^Show lessons used/).first(), "Show lessons used (Ben)");
  await other.waitForTimeout(2500);
  const text = await dumpText(other, 5000);
  check("Ben's parent sees Ben's lessons", /Ben W6pd · W6PD Backdate/.test(text));
  check("…and none of Ava's", !/Ava W6pd/.test(text));

  // The screen only asks for its own packages; the gate is the RPC's. Ask it for Ava's directly.
  const API = process.env.API_URL ?? "http://127.0.0.1:54321";
  // run-all-drivers.sh exports ANON_KEY; standalone, read it from the stack.
  const KEY = process.env.ANON_KEY
    ?? execSync("supabase status -o env", { encoding: "utf8" }).match(/^ANON_KEY="?([^"\n]+)"?/m)?.[1];
  const tok = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "w6pd-parent-ben@swimsync.test", password: "password123" }),
  }).then((r) => r.json());
  const res = await fetch(`${API}/rest/v1/rpc/package_usage`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_package: PKG.ava }),
  });
  const body = await res.json().catch(() => null);
  check("package_usage(Ava's package) as Ben's parent is REFUSED (42501)",
    !res.ok && body?.code === "42501", `HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 120)}`);
});

// ── 5. Billing months: Nothing to bill ──────────────────────────────────────────────────────────────────────
await section("5. Billing months: an ended, fully drawn month reads Nothing to bill", async () => {
  const months = await desktop();
  await loginAdmin(months, "w6pd-months@swimsync.test");
  await months.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  const row = months.getByTestId(`billing-month-${M1}`);
  await row.waitFor({ timeout: 20000 });
  await months.screenshot({ path: shot("admin-billing-months"), fullPage: true });
  const state = await row.getAttribute("data-state");
  const text = await row.innerText();
  check(`${M1} is package_funded`, state === "package_funded", `data-state=${state}`);
  check("…and reads Nothing to bill, Generate optional", /Nothing to bill/.test(text) && /Generate to close it for Accounting \(optional\)/.test(text),
    text.replace(/\s+/g, " "));
});

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
