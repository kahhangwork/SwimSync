// verify-admin-reset-password.mjs — the admin panel's password RECOVERY path,
// through a REAL GoTrue recovery link: `/reset-password` parses the session
// from the URL hash (detectSessionInUrl → getSession / onAuthStateChange),
// refuses a mismatch and a short password, sets the new one and signs out; and
// an `#error=` link reads "Link expired" even in a browser that is already
// signed in. Before this, only verify-smoke-admin opened the page, and only on
// its signed-out 3-second-timeout INVALID branch.
//
// Fixture: fixtures-admin-reset-password.sql   Teardown: fixtures-admin-reset-password-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U9. BACKLOG item: "A driver for the `reset-password` recovery path".
// Promoted from docs/refactor/batch-e-handchecks.mjs (its former check 7).
//
// OWN ADMIN, PER-RUN PASSWORD. The hand-check reset the SEED admin's password
// and had to restore it (§7.251). Here the admin is the fixture's own
// (admin-reset-owner@swimsync.test), the fixture puts `password123` back on
// every load, and the new password is `reset-<Date.now()>` — asserted REFUSED
// before the reset, so "the new password signs in" cannot pass on a leftover
// from an earlier run (plan ⚠ RISK 4). Every refusal is also asserted in the
// DATABASE: the auth.users password hash is unchanged. (Only by the hash, not
// by extra sign-in probes: GoTrue allows 30 password sign-ins per 5 min per IP
// (config.toml `sign_in_sign_ups`), shared with the drivers before this one in
// the nightly — this driver makes five.)
//
// REDIRECT. Only :3000 is in supabase/config.toml additional_redirect_urls; on
// any other ADMIN_URL GoTrue silently swaps the redirect for site_url (§7.41),
// so the driver fails loudly with "redirect not allow-listed" instead of a
// product-sounding red.
//
// The `#error=` link is opened SIGNED IN on purpose. Signed out, dropping the
// hash check still ends on "Link expired" — via the 3 s no-session timer — so
// a signed-out check cannot tell the two apart. Signed in, supabase-js keeps
// the stored session on a failed URL login, and without the hash check the
// page would offer to change the SIGNED-IN account's password.
//
// The empty-submit refusal ("Please enter and confirm…") is NOT driven: both
// inputs are `required`, so the browser's own validation blocks the submit and
// handleReset never runs from the UI.
//
// MUTATION PROOFS (§7.25) — each made on app code, run, seen red, reverted
// (`git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean after):
//
//   | # | mutation                                                            | result | red checks |
//   |---|---------------------------------------------------------------------|--------|------------|
//   | 1 | reset-password/domain/useResetPassword.ts:74 → `{ error: null }`     | 15/18  | "the stored password hash CHANGED", "the NEW password signs in", "password123 no longer signs in" (the page still says "Password updated" — only the DB/sign-in asserts see it) |
//   |   |   instead of `await updatePassword(password)`                       |        |            |
//   | 2 | reset-password/domain/useResetPassword.ts:35 → `/never=/`            | 16/18  | "an #error= link reads Link expired even with a live session" (the page offered the password form), "…offers Request New Link" |
//
// (2026-09-26, both reverted — scores recounted to 18: the two sign-in probes dropped afterwards were
// green in both proofs; `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean; the served
// reset-password chunk grepped for the mutated text — present after the edit, absent after the revert.)

import { execFileSync, execSync } from "node:child_process";
import { launch, loginAdmin, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
const API_URL = "http://127.0.0.1:54321";
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

// run-all-drivers.sh exports both keys; a solo run reads them off the stack.
let statusEnv = null;
const key = (k) => {
  if (process.env[k]) return process.env[k];
  statusEnv ??= execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const m = statusEnv.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, "m"));
  if (!m) throw new Error(`${k} not in \`supabase status -o env\``);
  return m[1];
};
// Resolved relative to this file — the checkout lives elsewhere on the CI runner.
const { createClient } = await import(
  new URL("../../../../SwimSyncAdmin/node_modules/@supabase/supabase-js/dist/index.mjs", import.meta.url).href
);
const service = createClient(API_URL, key("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
// A FRESH anon client per attempt — nothing cached from a previous sign-in.
const signsIn = async (email, password) => {
  const c = createClient(API_URL, key("ANON_KEY"), { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  return !error && !!data?.session;
};

const ADMIN_ID = "d6000000-0000-0000-0000-0000000000a1";
const EMAIL = "admin-reset-owner@swimsync.test";
const NEW_PASSWORD = `reset-${Date.now()}`;
const hashQ = `SELECT encrypted_password FROM auth.users WHERE id='${ADMIN_ID}'`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
// supabase-js keeps its session in localStorage under sb-<ref>-auth-token.
const storedSessions = (p) =>
  p.evaluate(() => Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)).length);
// Which branch did the page settle on? Waits for one of the terminal texts.
const settled = async (p) => {
  const expired = p.getByRole("heading", { name: "Link expired" });
  const form = p.getByRole("button", { name: "Update Password" });
  await expired.or(form).first().waitFor({ timeout: 15000 }).catch(() => {});
  if (await expired.isVisible()) return "invalid";
  if (await form.isVisible()) return "valid";
  return `(neither) ${(await p.innerText("body")).replace(/\n/g, " | ").slice(0, 160)}`;
};

const { browser, page } = await launch({ headless: true });
page.setDefaultTimeout(15000);
if (process.env.SHOT_DIR) console.log("shots:", process.env.SHOT_DIR);
let rp = null;

try {
  // ── 0. Preconditions: the fixture's admin holds password123, and the ─────
  //    per-run password is REFUSED before anything is reset.
  check("PRECONDITION: the fixture admin exists and signs in with password123",
    sql(`SELECT count(*) FROM auth.users WHERE id='${ADMIN_ID}' AND email='${EMAIL}'`) === "1"
      && await signsIn(EMAIL, "password123"));
  check("PRECONDITION: this run's new password is REFUSED before the reset",
    !(await signsIn(EMAIL, NEW_PASSWORD)), NEW_PASSWORD);
  const hash0 = sql(hashQ);

  // ── 1. An `#error=` link, opened in a SIGNED-IN browser ───────────────────
  await loginAdmin(page, EMAIL);
  check("PRECONDITION: the admin is signed in (a stored session exists)",
    !page.url().includes("/login") && (await storedSessions(page)) === 1, page.url());
  await page.goto(`${ADMIN}/reset-password#error=access_denied&error_code=otp_expired` +
    `&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: "domcontentloaded" });
  const errBranch = await settled(page);
  check("⚠ an #error= link reads \"Link expired\" even with a live session (no password form)",
    errBranch === "invalid" && (await page.locator('input[type="password"]').count()) === 0, errBranch);
  check("…and offers Request New Link → /forgot-password",
    (await page.getByRole("link", { name: "Request New Link" }).getAttribute("href").catch(() => null))
      === "/forgot-password");

  // ── 2. A REAL recovery link, in a fresh (signed-out) browser ──────────────
  const want = `${ADMIN}/reset-password`;
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({
    type: "recovery", email: EMAIL, options: { redirectTo: want },
  });
  if (linkErr) throw new Error(`generateLink(recovery): ${linkErr.message} — reload the fixture`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  rp = await ctx.newPage();
  rp.setDefaultTimeout(15000);
  await rp.goto(link.properties.action_link, { waitUntil: "domcontentloaded" });
  await rp.waitForURL((u) => u.href.startsWith(want), { timeout: 15000 }).catch(() => {});
  const landed = rp.url().startsWith(want);
  check("the verify redirect lands on the admin's /reset-password", landed, rp.url().split("#")[0]);
  if (!landed) {
    throw new Error(`redirect not allow-listed: ${want} is not in supabase/config.toml ` +
      `additional_redirect_urls, so GoTrue sent the link to ${rp.url().split("#")[0]} (§7.41) — run the admin on :3000`);
  }
  const validBranch = await settled(rp);
  check("⚠ a VALID recovery link renders the Set New Password form (not \"Link expired\")",
    validBranch === "valid", validBranch);

  const pw = rp.locator('input[type="password"]');
  const submit = rp.getByRole("button", { name: "Update Password" });
  const errorText = rp.locator("p.text-red-600");

  // Mismatch → refused, password untouched.
  await pw.nth(0).fill(NEW_PASSWORD);
  await pw.nth(1).fill(`${NEW_PASSWORD}x`);
  await submit.click();
  const mismatchMsg = await errorText.innerText({ timeout: 8000 }).catch(() => "(no error shown)");
  check("a mismatched confirmation is refused: \"Passwords do not match.\"",
    mismatchMsg === "Passwords do not match.", mismatchMsg);
  // Give a wrongly-accepted submit time to land before reading "unchanged".
  const hashAfterMismatch = await dbUntil(hashQ, (v) => v !== hash0, 2500);
  check("…the stored password hash is UNCHANGED", hashAfterMismatch === hash0);

  // Seven characters: GoTrue's own minimum is 6, so only the page stops it.
  const SHORT = "short7x";
  await pw.nth(0).fill(SHORT);
  await pw.nth(1).fill(SHORT);
  await submit.click();
  const shortMsg = await errorText.filter({ hasText: "8 characters" })
    .innerText({ timeout: 8000 }).catch(async () => (await errorText.innerText().catch(() => "(no error shown)")));
  check("a 7-character password is refused: \"Password must be at least 8 characters.\"",
    shortMsg === "Password must be at least 8 characters.", shortMsg);
  const hashAfterShort = await dbUntil(hashQ, (v) => v !== hash0, 2500);
  check("…the stored password hash is UNCHANGED", hashAfterShort === hash0);

  // The real update.
  await pw.nth(0).fill(NEW_PASSWORD);
  await pw.nth(1).fill(NEW_PASSWORD);
  await submit.click();
  const done = await rp.getByRole("heading", { name: "Password updated" })
    .waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check("Update Password → \"Password updated\"", done,
    done ? "" : (await rp.innerText("body")).replace(/\n/g, " | ").slice(0, 200));
  const hashAfter = await dbUntil(hashQ, (v) => v !== hash0);
  check("⚠ the stored password hash CHANGED", hashAfter !== hash0);
  check("⚠ the NEW password signs in (fresh anon client)", await signsIn(EMAIL, NEW_PASSWORD), NEW_PASSWORD);
  check("⚠ password123 no longer signs in", !(await signsIn(EMAIL, "password123")));
  const left = await (async () => {
    const end = Date.now() + 5000;
    let n = await storedSessions(rp);
    while (n !== 0 && Date.now() < end) { await rp.waitForTimeout(250); n = await storedSessions(rp); }
    return n;
  })();
  check("the recovery session is signed out afterwards (clean re-login)", left === 0, `stored sessions ${left}`);
  check("…and Back to Sign In → /login",
    (await rp.getByRole("link", { name: "Back to Sign In" }).getAttribute("href").catch(() => null)) === "/login");

  // ── 3. The link is ONE-SHOT: a second open no longer yields a session ─────
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const again = await ctx2.newPage();
  await again.goto(link.properties.action_link, { waitUntil: "domcontentloaded" });
  await again.waitForURL((u) => u.href.startsWith(want), { timeout: 15000 }).catch(() => {});
  const reuse = await settled(again);
  check("re-opening the SAME link after use reads \"Link expired\"", reuse === "invalid", reuse);
  await ctx2.close();
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/admin-reset-password-error-link.png`, fullPage: true }).catch(() => {});
    if (rp) await rp.screenshot({ path: `${process.env.SHOT_DIR}/admin-reset-password-final.png`, fullPage: true }).catch(() => {});
  }
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
