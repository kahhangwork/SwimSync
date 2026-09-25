// verify-app-auth.mjs — the app's auth paths a driver either hides or never reaches.
//
// WHY THIS EXISTS. Promoted from the App L-F/G/H fence hand-check
// (docs/refactor/app-fgh-handchecks-fence.mjs), which passed on the pre-refactor
// AND the refactored code, so every check here is proven, not drafted. Before it,
// none of these ran in the nightly:
//   1. ONE-SHOT login, parent and coach — fresh context, ONE press, no reload.
//      loginExpo retries three times, which is exactly what hides a login
//      regression; this and appLoginDies are the only one-shot logins (§7.263).
//      A wrong password shows the friendlyAuthError copy and stays on /login.
//   2. Change Password, both roles (the shared features/change-password screen).
//   3. Forgot Password: the send → "Check your email", and Mailpit receives it.
//   4. Reset Password through a REAL recovery link → /login → the new password works.
//   5. Accept Invite through a REAL invite link → name + password → /login → it
//      works, and profiles.full_name is written.
//   6. The coach grade viewer on a real student (read-only since 20260829000100).
//   7. Parent Sign Out: confirm → /login, and a reload stays signed out.
// Links come from auth.admin.generateLink — the call the admin panel's own
// invite-parent route makes — so the browser walks GoTrue's real redirect.
//
// ⚠ PASSWORDS ARE RESTORED IN `finally`. Checks 2 and 4 change real passwords,
// one of them the SEED coach's; a run that dies between the change and the
// restore would otherwise leave coach@swimsync.test unable to log in, and every
// later driver on the shared DB would red on login.
//
// Setup:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-app-auth.sql
//   Expo web on :8081 (or EXPO_URL). Mailpit on :54324 (part of `supabase start`).
//   ⚠ Checks 4–5 need Expo on EXACTLY localhost:8081 — the only app origin in
//   supabase/config.toml additional_redirect_urls. On any other port (a worktree's
//   8082) GoTrue swaps the link's redirect for site_url and actionLink() throws.
//
// Personas (all password123):
//   app-auth-parent@swimsync.test   fixture parent, one child enrolled in Saturday Beginners
//   coach@swimsync.test             seed tenant admin + coach of Saturday Beginners
//   app-auth-invite@swimsync.test   created by check 5 (the fixture + teardown remove it)

import os from "node:os";
import { execSync } from "node:child_process";
import { launch, loginExpo, pressByText, visibleText, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/app-auth-${n}.png`;
const API_URL = "http://127.0.0.1:54321";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

const PARENT = "app-auth-parent@swimsync.test";
const COACH = "coach@swimsync.test";
const INVITEE = "app-auth-invite@swimsync.test";
const CHILD = "Auth Driver Kid";

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"`)
    .toString()
    .trim();

// run-all-drivers.sh exports both keys; a solo run reads them off the stack.
let statusEnv = null;
const key = (k) => {
  if (process.env[k]) return process.env[k];
  statusEnv ??= execSync("supabase status -o env", { encoding: "utf8" });
  return statusEnv.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, "m"))[1];
};
// Resolved relative to this file — the checkout lives elsewhere on the CI runner.
const { createClient } = await import(
  new URL("../../../../SwimSyncAdmin/node_modules/@supabase/supabase-js/dist/index.mjs", import.meta.url).href
);
const admin = createClient(API_URL, key("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const anonSignIn = async (email, password) => {
  const c = createClient(API_URL, key("ANON_KEY"), { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  return !error;
};
const setPassword = async (email, password) => {
  const uid = psql(`SELECT id FROM auth.users WHERE email = '${email}'`);
  if (!uid) throw new Error(`no auth user ${email}`);
  const { error } = await admin.auth.admin.updateUserById(uid, { password });
  if (error) throw error;
};
const waitOk = (p) => p.then(() => true).catch(() => false);

/** A generated link whose redirect GoTrue kept. An origin missing from
 *  config.toml's additional_redirect_urls is SILENTLY swapped for site_url
 *  (§7.41) — the link then lands on the admin panel, and the check dies on a
 *  connection error that reads like an app bug. Say what it really is. */
const actionLink = (data, want) => {
  const link = data.properties.action_link;
  const got = new URL(link).searchParams.get("redirect_to");
  if (got !== want) {
    throw new Error(
      `GoTrue replaced redirect_to ${want} with ${got}: ${new URL(want).origin} is not in ` +
        `supabase/config.toml additional_redirect_urls (§7.41) — run Expo on :8081`
    );
  }
  return link;
};

// The fixture is the precondition; a half-loaded one must not read as a product red.
if (psql(`SELECT count(*) FROM auth.users WHERE email = '${PARENT}'`) !== "1") {
  console.error(`✗ ${PARENT} is missing — load fixtures-app-auth.sql first`);
  process.exit(1);
}

/** Hold the page's profiles READ 4 s. The layout's routeForSession replaces to
 *  the recovery / invite screen only after that read, and a replace to the route
 *  already showing re-mounted it, wiping what was typed (§7.274). Locally the read
 *  beats the form; CI and slow phones don't — this makes every run the slow one.
 *  GETs only: accept-invite's own submit PATCHes profiles. `returned()` resolves
 *  once the held read is answered, plus 1.5 s for any replace it triggers. */
const holdProfilesRead = async (page) => {
  const PROFILES = /\/rest\/v1\/profiles/;
  await page.route(PROFILES, async (r) => {
    if (r.request().method() === "GET") await new Promise((z) => setTimeout(z, 4000));
    await r.continue().catch(() => {});
  });
  const back = page
    .waitForResponse((res) => PROFILES.test(res.url()) && res.request().method() === "GET", { timeout: 45000 })
    .then(() => true, () => false);
  return { returned: async () => (await back) && (await page.waitForTimeout(1500), true) };
};

const browsers = [];
const fresh = async () => {
  const b = await launch();
  browsers.push(b.browser);
  return b;
};

try {
  // ── 1. one-shot login ─────────────────────────────────────────────────────
  for (const [email, landing, name] of [
    [PARENT, /\/home$/, "parent"],
    [COACH, /\/schedule$/, "coach"],
  ]) {
    const { browser, page } = await fresh();
    await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
    // Wait for the FORM, not a fixed hydrate sleep — a slow cold load is not a
    // login failure (the §7.262 lesson). A form that never came is its own FAIL.
    const form = await waitOk(page.getByPlaceholder("you@email.com").waitFor({ timeout: 45000 }));
    check(`1: ${name} login form rendered`, form);
    if (form) {
      await page.getByPlaceholder("you@email.com").fill(email);
      await page.locator('input[type="password"]').fill("password123");
      const t0 = Date.now();
      await pressByText(page, "Sign In", 1); // [0] is the card heading, [1] the button
      const left = await waitOk(page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 10000 }));
      const path = new URL(page.url()).pathname;
      check(`1: ${name} ONE-SHOT login leaves /login and lands on ${landing.source.replace(/[\\^$]/g, "")}`, left && landing.test(path), `${Date.now() - t0} ms → ${path}`);
    }
    await page.screenshot({ path: shot(`1-${name}`) });
    await browser.close();
  }
  {
    const { browser, page } = await fresh();
    await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("you@email.com").waitFor({ timeout: 45000 });
    await page.getByPlaceholder("you@email.com").fill(PARENT);
    await page.locator('input[type="password"]').fill("not-the-password");
    await pressByText(page, "Sign In", 1);
    // The Toast is transient — wait for the message itself, then confirm we never left.
    const msg = await waitOk(page.getByText("Incorrect email or password.").first().waitFor({ timeout: 10000 }));
    check("1: a wrong password shows 'Incorrect email or password.'", msg);
    check("1: …and stays on /login", /\/login$/.test(new URL(page.url()).pathname), page.url());
    await browser.close();
  }

  // ── 2. change password, both roles ────────────────────────────────────────
  for (const [email, tab, name] of [
    [PARENT, "Profile", "parent"],
    [COACH, "Settings", "coach"],
  ]) {
    // Reached by TAP (tab → Change Password): a deep link leaves it hidden (§7.254).
    const { browser, page } = await fresh();
    try {
      await loginExpo(page, email);
      await pressByText(page, tab);
      await page.waitForTimeout(2500);
      await pressByText(page, "Change Password");
      await page.locator('text="Update Password" >> visible=true').waitFor({ timeout: 30000 });
      const pw = page.locator('input[type="password"] >> visible=true');
      await pw.nth(0).fill("password456");
      await pw.nth(1).fill("password456");
      await pressByText(page, "Update Password");
      const done = await waitOk(page.getByText("Password updated").first().waitFor({ timeout: 15000 }));
      check(`2: ${name} Change Password shows "Password updated"`, done);
      check(`2: ${name} can sign in with the new password`, await anonSignIn(email, "password456"));
      check(`2: ${name} can NOT sign in with the old one`, !(await anonSignIn(email, "password123")));
      await page.screenshot({ path: shot(`2-${name}`) });
    } finally {
      await browser.close();
      await setPassword(email, "password123");
    }
  }

  // ── 3. forgot password → Mailpit ──────────────────────────────────────────
  {
    // No DELETE on the inbox — it is shared with every sibling on the stack.
    // Count only mail to this parent that arrived after the press. The slack
    // absorbs clock skew between the host and the Docker VM that stamps
    // `Created`; a previous run's mail is older than any sane skew.
    const since = Date.now() - 30000;
    const { browser, page } = await fresh();
    // Reached by TAP from /login, as a parent does.
    await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
    await page.getByText("Forgot password?").first().waitFor({ timeout: 45000 });
    await pressByText(page, "Forgot password?");
    await page.locator('text="Send Reset Link" >> visible=true').waitFor({ timeout: 30000 });
    await page.locator('input[placeholder="you@email.com"] >> visible=true').fill(PARENT);
    await pressByText(page, "Send Reset Link");
    const sent = await waitOk(page.getByText("Check your email").first().waitFor({ timeout: 15000 }));
    check('3: Forgot Password shows "Check your email"', sent);
    let hit = false;
    for (let i = 0; i < 10 && !hit; i++) {
      await page.waitForTimeout(1000);
      const inbox = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
      hit = (inbox.messages ?? []).some(
        (m) => Date.parse(m.Created) >= since && (m.To ?? []).some((t) => t.Address === PARENT)
      );
    }
    check("3: Mailpit received the reset email for the parent", hit);
    await page.screenshot({ path: shot("3-forgot") });
    await browser.close();
  }

  // ── 4. reset password through a real recovery link ────────────────────────
  {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: PARENT,
      options: { redirectTo: `${EXPO}/reset-password` },
    });
    if (error) throw error;
    const { browser, page } = await fresh();
    try {
      // Nightlies 36006182210 / 36071084202 found the fields EMPTY after a fill
      // (§7.274). Fill ONCE; never refill — a refill hides the bug.
      const held = await holdProfilesRead(page);
      await page.goto(actionLink(data, `${EXPO}/reset-password`), { waitUntil: "domcontentloaded" });
      await page.getByText("Update Password").last().waitFor({ timeout: 45000 });
      const pw = () => page.locator('input[type="password"]');
      await pw().nth(0).fill("password789");
      await pw().nth(1).fill("password789");
      check("4: the held profiles read returned", await held.returned());
      check(
        "4: the typed passwords survive the late session restore (no re-mount)",
        (await pw().nth(0).inputValue()) === "password789" && (await pw().nth(1).inputValue()) === "password789"
      );
      await pressByText(page, "Update Password");
      check("4: Reset Password returns to /login", await waitOk(page.waitForURL(/\/login/, { timeout: 15000 })), page.url());
      check("4: the reset password works", await anonSignIn(PARENT, "password789"));
      await page.screenshot({ path: shot("4-reset") });
    } finally {
      await browser.close();
      await setPassword(PARENT, "password123");
    }
  }

  // ── 5. accept invite through a real invite link ───────────────────────────
  {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email: INVITEE,
      options: { data: { role: "parent", full_name: "" }, redirectTo: `${EXPO}/accept-invite` },
    });
    if (error) throw new Error(`generateLink(invite): ${error.message} — reload fixtures-app-auth.sql`);
    const { browser, page } = await fresh();
    const held = await holdProfilesRead(page); // same late replace, to /accept-invite (§7.274)
    await page.goto(actionLink(data, `${EXPO}/accept-invite`), { waitUntil: "domcontentloaded" });
    const form = await waitOk(page.getByPlaceholder("Sarah Lim").waitFor({ timeout: 45000 }));
    check("5: the invite link opens the Accept Invite form", form, page.url());
    if (form) {
      await page.getByPlaceholder("Sarah Lim").fill("Invited Parent");
      await page.getByPlaceholder("9123 4567").fill("91230000");
      await page.locator('input[type="password"]').nth(0).fill("password123");
      await page.locator('input[type="password"]').nth(1).fill("password123");
      check("5: the held profiles read returned", await held.returned());
      check(
        "5: the typed form survives the late session restore (no re-mount)",
        (await page.getByPlaceholder("Sarah Lim").inputValue()) === "Invited Parent" &&
          (await page.locator('input[type="password"]').nth(1).inputValue()) === "password123"
      );
      await pressByText(page, "Set Password");
      check("5: Set Password returns to /login", await waitOk(page.waitForURL(/\/login/, { timeout: 15000 })), page.url());
      check("5: the invited parent can sign in with the password they set", await anonSignIn(INVITEE, "password123"));
      const name = psql(`SELECT full_name FROM profiles p JOIN auth.users u ON u.id = p.id WHERE u.email = '${INVITEE}'`);
      check("5: profiles.full_name was written", name === "Invited Parent", name);
    }
    await page.screenshot({ path: shot("5-invite") });
    await browser.close();
  }

  // ── 6. the coach grade viewer on a real student ───────────────────────────
  {
    const row = psql(
      `SELECT s.id || '|' || e.class_id FROM students s
         JOIN student_class_enrolments e ON e.student_id = s.id AND e.is_active
        WHERE s.full_name = '${CHILD}' AND s.id = 'ac100000-0000-0000-0000-0000000000d1'`
    );
    const [sid, cid] = row.split("|");
    check("6: fixture: the child is enrolled in the coach's class", !!sid && !!cid, row);
    const { browser, page } = await fresh();
    await loginExpo(page, COACH);
    await page.goto(`${EXPO}/classes/${cid}/grade?studentId=${sid}`, { waitUntil: "domcontentloaded" });
    await page.getByText(CHILD).first().waitFor({ timeout: 30000 }).catch(() => {});
    const t = await page.evaluate(() => document.body.innerText);
    check("6: the grade viewer renders the real student", t.includes(CHILD) && !/Could not load this child/.test(t));
    await page.screenshot({ path: shot("6-grade") });
    await browser.close();
  }

  // ── 7. parent Sign Out ─────────────────────────────────────────────────────
  {
    const { browser, page } = await fresh();
    await loginExpo(page, PARENT);
    await pressByText(page, "Profile");
    await page.getByText("Sign Out").last().waitFor({ timeout: 20000 });
    await pressByText(page, "Sign Out"); // confirmAction → window.confirm, accepted by launch()
    check("7: parent Sign Out lands on /login", await waitOk(page.waitForURL(/\/login/, { timeout: 15000 })), page.url());
    await page.reload({ waitUntil: "domcontentloaded" });
    // The form, not a sleep: a restored session would bounce off /login once hydrated.
    await page.getByPlaceholder("you@email.com").waitFor({ timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    check("7: …and a reload stays signed out", /\/login/.test(page.url()), page.url());
    const body = await visibleText(page);
    check("7: …showing the login form, not a signed-in screen", body.includes("Forgot password?"));
    await browser.close();
  }
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  // Belt and braces: whatever threw, the seed coach and fixture parent log in again.
  for (const email of [COACH, PARENT]) {
    await setPassword(email, "password123").catch((e) => console.error(`✗ could not restore ${email}: ${e.message}`));
  }
  for (const b of browsers) await b.close().catch(() => {});
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
