// Hand-checks for the app FENCE sub-batch (docs/refactor/BATCH_FGH_PLAN.md, ⚠ R1 + R5) —
// the auth paths a driver either hides (loginExpo's 3-try retry) or never reaches.
//   1. ONE-SHOT login, parent and coach: fresh context, one press, no reload — the URL
//      leaves /login within 10 s and lands on /home, /schedule. A wrong password shows
//      the friendlyAuthError message and stays on /login. (R1)
//   2. Change Password, both roles (the shared features/change-password screen).
//   3. Forgot Password: the send → "Check your email", and Mailpit receives it.
//   4. Reset Password through a REAL recovery link → Update → /login → the new password works.
//   5. Accept Invite through a REAL invite link → name + password → /login → it works,
//      profiles.full_name written.
//   6. The coach grade viewer on a real student (read-only since 20260829000100).
//   7. Parent Sign Out: confirm → /login, and a reload stays signed out.
// Links are made with auth.admin.generateLink — the call the admin panel's own
// invite-parent route makes — so the browser walks GoTrue's real redirect into the
// app. Run from .claude/skills/run-ui-playwright/drivers/ (copy it there) after a db
// reset + fixtures-payment-collection.sql. Fixture writes THROW (§7.251).
import { launch, loginExpo, pressByText, EXPO } from "./lib.mjs";
import { execSync } from "node:child_process";

const SHOT = process.env.SHOTDIR ?? "/tmp";
const TAG = process.env.TAG ?? "hc";
const API_URL = "http://127.0.0.1:54321";
const { createClient } = await import(
  new URL("../../../../SwimSyncAdmin/node_modules/@supabase/supabase-js/dist/index.mjs", import.meta.url).href
);
const env = execSync("supabase status -o env", { encoding: "utf8" });
const key = (k) => env.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, "m"))[1];
const admin = createClient(API_URL, key("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const anonSignIn = async (email, password) => {
  const c = createClient(API_URL, key("ANON_KEY"), { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  return !error;
};
const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"`)
    .toString()
    .trim();
const res = [];
const check = (ok, msg) => res.push(`${ok ? "PASS" : "FAIL"} ${msg}`);
const PARENT = "pay-driver-parent@swimsync.test";
const COACH = "coach@swimsync.test";

async function oneShot(email, password, landing) {
  const { browser, page } = await launch();
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("you@email.com").waitFor({ timeout: 45000 });
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  const t0 = Date.now();
  await pressByText(page, "Sign In", 1); // [0] is the card heading, [1] the button
  const left = await page
    .waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const ms = Date.now() - t0;
  const path = new URL(page.url()).pathname;
  return { browser, page, left, ms, path, ok: landing.test(path) };
}

// ── 1. one-shot login (R1) ────────────────────────────────────────────────
for (const [email, landing, name] of [
  [PARENT, /\/home$/, "parent"],
  [COACH, /\/schedule$/, "coach"],
]) {
  const r = await oneShot(email, "password123", landing);
  check(r.left && r.ok, `1: ${name} one-shot login leaves /login in ${r.ms} ms and lands on ${r.path}`);
  await r.page.screenshot({ path: `${SHOT}/hcX-${TAG}-1-${name}.png` });
  await r.browser.close();
}
{
  // The Toast is transient — wait for the message itself, then confirm we never left.
  const { browser, page } = await launch();
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("you@email.com").waitFor({ timeout: 45000 });
  await page.getByPlaceholder("you@email.com").fill(PARENT);
  await page.locator('input[type="password"]').fill("not-the-password");
  await pressByText(page, "Sign In", 1);
  const msg = await page.getByText("Incorrect email or password.").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check(msg && /\/login$/.test(new URL(page.url()).pathname), "1: a wrong password stays on /login with 'Incorrect email or password.'");
  await browser.close();
}

// ── 2. change password, both roles ────────────────────────────────────────
for (const [email, tab, name] of [
  [PARENT, "Profile", "parent"],
  [COACH, "Settings", "coach"],
]) {
  // Reached by TAP (tab → Change Password): a deep link leaves it hidden (§7.254).
  const { browser, page } = await launch();
  await loginExpo(page, email);
  await pressByText(page, tab);
  await page.waitForTimeout(2500);
  await pressByText(page, "Change Password");
  await page.locator('text="Update Password" >> visible=true').waitFor({ timeout: 30000 });
  const pw = page.locator('input[type="password"] >> visible=true');
  await pw.nth(0).fill("password456");
  await pw.nth(1).fill("password456");
  await pressByText(page, "Update Password");
  const done = await page.getByText("Password updated").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check(done, `2: ${name} change password shows "Password updated"`);
  check(await anonSignIn(email, "password456"), `2: ${name} can sign in with the new password`);
  await page.screenshot({ path: `${SHOT}/hcX-${TAG}-2-${name}.png` });
  await browser.close();
  // put it back so the rest of the checks (and nothing after) are affected
  const uid = psql(`SELECT id FROM auth.users WHERE email = '${email}'`);
  const { error } = await admin.auth.admin.updateUserById(uid, { password: "password123" });
  if (error) throw error;
}

// ── 3. forgot password → Mailpit ──────────────────────────────────────────
{
  await fetch("http://127.0.0.1:54324/api/v1/messages", { method: "DELETE" });
  const { browser, page } = await launch();
  // Reached by TAP from /login, as a parent does.
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.getByText("Forgot password?").first().waitFor({ timeout: 45000 });
  await pressByText(page, "Forgot password?");
  await page.locator('text="Send Reset Link" >> visible=true').waitFor({ timeout: 30000 });
  await page.locator('input[placeholder="you@email.com"] >> visible=true').fill(PARENT);
  await pressByText(page, "Send Reset Link");
  const sent = await page.getByText("Check your email").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check(sent, '3: forgot password shows "Check your email"');
  await page.waitForTimeout(3000);
  const inbox = await (await fetch("http://127.0.0.1:54324/api/v1/messages")).json();
  const hit = (inbox.messages ?? []).some((m) => (m.To ?? []).some((t) => t.Address === PARENT));
  check(hit, "3: Mailpit received the reset email for the parent");
  await page.screenshot({ path: `${SHOT}/hcX-${TAG}-3-forgot.png` });
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
  const { browser, page } = await launch();
  await page.goto(data.properties.action_link, { waitUntil: "domcontentloaded" });
  await page.getByText("Update Password").last().waitFor({ timeout: 45000 });
  await page.locator('input[type="password"]').nth(0).fill("password789");
  await page.locator('input[type="password"]').nth(1).fill("password789");
  await pressByText(page, "Update Password");
  const back = await page.waitForURL(/\/login/, { timeout: 15000 }).then(() => true).catch(() => false);
  check(back, "4: reset password returns to /login");
  check(await anonSignIn(PARENT, "password789"), "4: the reset password works");
  await page.screenshot({ path: `${SHOT}/hcX-${TAG}-4-reset.png` });
  await browser.close();
  const uid = psql(`SELECT id FROM auth.users WHERE email = '${PARENT}'`);
  const r = await admin.auth.admin.updateUserById(uid, { password: "password123" });
  if (r.error) throw r.error;
}

// ── 5. accept invite through a real invite link ───────────────────────────
{
  const email = `hcinvite-${Date.now()}@swimsync.test`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { role: "parent", full_name: "" }, redirectTo: `${EXPO}/accept-invite` },
  });
  if (error) throw error;
  const { browser, page } = await launch();
  await page.goto(data.properties.action_link, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Sarah Lim").waitFor({ timeout: 45000 });
  check(true, "5: the invite link opens the Accept Invite form");
  await page.getByPlaceholder("Sarah Lim").fill("Invited Parent");
  await page.getByPlaceholder("9123 4567").fill("91230000");
  await page.locator('input[type="password"]').nth(0).fill("password123");
  await page.locator('input[type="password"]').nth(1).fill("password123");
  await pressByText(page, "Set Password");
  const back = await page.waitForURL(/\/login/, { timeout: 15000 }).then(() => true).catch(() => false);
  check(back, "5: Set Password returns to /login");
  check(await anonSignIn(email, "password123"), "5: the invited parent can sign in with the password they set");
  check(psql(`SELECT full_name FROM profiles p JOIN auth.users u ON u.id = p.id WHERE u.email = '${email}'`) === "Invited Parent", "5: profiles.full_name was written");
  await page.screenshot({ path: `${SHOT}/hcX-${TAG}-5-invite.png` });
  await browser.close();
}

// ── 6. the coach grade viewer on a real student ───────────────────────────
{
  // The seed enrols nobody; the student-identity fixture (the one levels /
  // level-skills run on) enrols children in the coach's class.
  execSync(
    "docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < fixtures-student-identity.sql"
  );
  const row = psql(
    `SELECT s.id || '|' || e.class_id || '|' || s.full_name FROM students s
       JOIN student_class_enrolments e ON e.student_id = s.id AND e.is_active
       JOIN classes c ON c.id = e.class_id
       JOIN coaches co ON co.id = c.coach_id JOIN auth.users u ON u.id = co.profile_id
      WHERE u.email = '${COACH}' ORDER BY s.full_name LIMIT 1`
  );
  const [sid, cid, sname] = row.split("|");
  if (!sid) throw new Error("6: fixture produced no enrolled student for the coach");
  check(true, `6: fixture: a student in the coach's class (${sname})`);
  const { browser, page } = await launch();
  await loginExpo(page, COACH);
  await page.goto(`${EXPO}/classes/${cid}/grade?studentId=${sid}`, { waitUntil: "domcontentloaded" });
  await page.getByText(sname).first().waitFor({ timeout: 30000 }).catch(() => {});
  const t = await page.evaluate(() => document.body.innerText);
  check(t.includes(sname) && !/Could not load this child/.test(t), "6: the grade viewer renders the real student");
  await page.screenshot({ path: `${SHOT}/hcX-${TAG}-6-grade.png` });
  await browser.close();
}

// ── 7. parent Sign Out ─────────────────────────────────────────────────────
{
  const { browser, page } = await launch();
  await loginExpo(page, PARENT);
  await pressByText(page, "Profile");
  await page.getByText("Sign Out").last().waitFor({ timeout: 20000 });
  await pressByText(page, "Sign Out"); // confirmAction → window.confirm, accepted by lib
  const out = await page.waitForURL(/\/login/, { timeout: 15000 }).then(() => true).catch(() => false);
  check(out, "7: parent Sign Out lands on /login");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  check(/\/login/.test(page.url()), `7: …and a reload stays signed out (${page.url()})`);
  await browser.close();
}

console.log(res.join("\n"));
console.log(`${res.filter((r) => r.startsWith("PASS")).length}/${res.length} hand-checks passed`);
process.exit(res.every((r) => r.startsWith("PASS")) ? 0 : 1);
