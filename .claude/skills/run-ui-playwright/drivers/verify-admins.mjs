// Drive co-admin management end to end (§8.31, 20260806000100).
//
// What only THIS driver can prove (pgTAP owns the RLS/RPC layer): the ban
// half of deactivation — bans live in auth, not the database — plus the
// owner-vs-co-admin difference in what the page offers, the typed-DELETE
// modal's gate, and the panel's role gate refusing a plain coach.
//
// Setup/Prereqs:
//   supabase start; admin panel on :3000 (or ADMIN_URL)
//   fixture: fixtures-admins.sql — and NOTE the driver consumes state
//   (deletes admindelete@, invites driver-invited@), so a re-run needs
//   fixtures-admins-teardown.sql (or a db reset) first.
//
// Personas (all password123):
//   coach@swimsync.test        seed OWNER (tenant_admin + coach — must enter)
//   adminpure@swimsync.test    pure co-admin (deactivate must BAN)
//   admincoach@swimsync.test   coach-admin (deactivate must NOT ban → suspension screen)
//   admindelete@swimsync.test  pure, unreferenced — the typed-DELETE target
//   adminhistory@swimsync.test pure, but an audit row names them ACTOR — the
//                              REFUSED delete (20260813000400). Survives the run.
//   gatecoach@swimsync.test    plain coach — the role gate's persona

import os from "node:os";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/admins-${n}`;

const results = [];
function check(label, pass, detail = "") {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : ` — ${detail}`}`);
}

const { browser, page } = await launch();

async function freshLogin(email) {
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, email);
}

/** Try to log in and report whether it left /login (banned/deleted must not). */
async function loginSticks(email) {
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  return !new URL(page.url()).pathname.includes("/login");
}

const row = (email) => page.locator("tr", { hasText: email });

// ── 1. The owner's view ─────────────────────────────────────────────────────
await freshLogin("coach@swimsync.test");
await page.goto(`${ADMIN}/admins`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
let body = await page.evaluate(() => document.body.innerText);

check("owner (tenant_admin + coach) reaches the Admins page",
  body.includes("Admins") && body.includes("adminpure@swimsync.test"), body.slice(0, 300));
check("the owner's own row wears the Owner badge", body.includes("Owner"));
check("both co-admin shapes are listed",
  body.includes("admincoach@swimsync.test") && body.includes("Admin + Coach"));
check("the owner sees the management buttons",
  body.includes("Invite admin") && body.includes("Deactivate"));
await page.screenshot({ path: shot("01-owner-view.png"), fullPage: true });

// ── 2. Invite — locally there is no RESEND key, so the WARNING is the pass ──
await page.getByText("Invite admin").first().click();
await page.getByPlaceholder("Priya Nair").fill("Driver Invited");
await page.getByPlaceholder("admin@example.com").fill("driver-invited@swimsync.test");
await page.getByRole("button", { name: "Send invite", exact: true }).click();
await page.waitForTimeout(2500);
body = await page.evaluate(() => document.body.innerText);

check("invite without an email key surfaces the hand-over link, not a fake success",
  body.includes("could not be sent") && body.includes("/accept-invite"), body.slice(0, 400));
check("the invited admin appears with status invited",
  (await row("driver-invited@swimsync.test").innerText()).includes("invited"));
await page.screenshot({ path: shot("02-invited.png"), fullPage: true });

// Dismiss the warning so the resend check below proves a FRESH one.
await page.getByText("Dismiss").click();
await page.waitForTimeout(500);

// ── 3. Resend, allowed only before first sign-in ────────────────────────────
await row("driver-invited@swimsync.test").getByText("Resend invite").click();
await page.waitForTimeout(2500);
body = await page.evaluate(() => document.body.innerText);
check("resend re-issues the link", body.includes("could not be sent"));

// ── 4. Deactivate a PURE admin: pill flips AND the login is banned ──────────
await row("adminpure@swimsync.test").getByText("Deactivate").click();
await page.waitForTimeout(3000);
check("deactivated pure admin's row says so",
  (await row("adminpure@swimsync.test").innerText()).includes("deactivated"));
await page.screenshot({ path: shot("03-deactivated.png"), fullPage: true });

check("a deactivated PURE admin cannot log in at all (the ban half)",
  !(await loginSticks("adminpure@swimsync.test")));

// ── 5. Reactivate: pill restored AND the ban lifted ─────────────────────────
await freshLogin("coach@swimsync.test");
await page.goto(`${ADMIN}/admins`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await row("adminpure@swimsync.test").getByText("Reactivate").click();
await page.waitForTimeout(3000);
check("reactivated admin is no longer marked deactivated",
  !(await row("adminpure@swimsync.test").innerText()).includes("deactivated"));

check("…and can log in again (the unban half)",
  await loginSticks("adminpure@swimsync.test"));

// ── 6. The co-admin's view: same page, no levers ────────────────────────────
await page.goto(`${ADMIN}/admins`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
body = await page.evaluate(() => document.body.innerText);
check("a co-admin sees the roster", body.includes("coach@swimsync.test"));
check("a co-admin gets NO management buttons",
  !body.includes("Invite admin") && !body.includes("Deactivate"));
await page.screenshot({ path: shot("04-coadmin-view.png"), fullPage: true });

// ── 7. Deactivate the COACH-admin: no ban — the suspension screen instead ───
await freshLogin("coach@swimsync.test");
await page.goto(`${ADMIN}/admins`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await row("admincoach@swimsync.test").getByText("Deactivate").click();
await page.waitForTimeout(3000);

check("a deactivated COACH-admin can still log in (never banned — coaching survives)",
  await loginSticks("admincoach@swimsync.test"));
body = await page.evaluate(() => document.body.innerText);
check("…and lands on the suspension screen, not the panel",
  body.includes("admin access has been suspended"), body.slice(0, 300));
await page.screenshot({ path: shot("05-suspended.png"), fullPage: true });

// ── 8. Typed DELETE on the disposable pure admin ────────────────────────────
await freshLogin("coach@swimsync.test");
await page.goto(`${ADMIN}/admins`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await row("admindelete@swimsync.test")
  .getByRole("button", { name: "Delete", exact: true })
  .click();
await page.waitForTimeout(800);

const confirmBtn = page.getByText("Delete account", { exact: true });
check("the delete button is dead until the word is typed",
  await confirmBtn.isDisabled());
body = await page.evaluate(() => document.body.innerText);
// Re-pointed at the NEW guarantee by 20260813000400. This used to assert the
// modal warned about the "audit-log" purge — that copy was correct until the
// purge was removed, and the assertion would have failed the nightly on the
// change that made it false. It is re-pointed rather than softened: an empty
// or generic modal must still fail this driver.
check("the modal says the audit trail refuses the delete, not that it is purged",
  body.includes("refused") && body.includes("audit trail") &&
  body.includes("cannot be undone"));

await page.getByPlaceholder("DELETE").fill("DELETE");
await confirmBtn.click();
await page.waitForTimeout(3000);
body = await page.evaluate(() => document.body.innerText);
check("the deleted admin is gone from the roster",
  !body.includes("admindelete@swimsync.test"));
await page.screenshot({ path: shot("06-deleted.png"), fullPage: true });

check("the deleted admin's login is dead",
  !(await loginSticks("admindelete@swimsync.test")));

// ── 8b. The OTHER half of delete: an admin with history is REFUSED ─────────
// 20260813000400. Everything above this line exercises the profile that never
// acted, which is the only profile the hard delete can still reach — so on its
// own it says nothing about the change that made history load-bearing. This
// block is the browser half of pgTAP checks 30-32, and it also covers the two
// things pgTAP cannot see: that the refusal message travels intact through
// delete-admin/route.ts into the modal, and that the compensating unban leaves
// the account WORKING rather than stranded banned.
await freshLogin("coach@swimsync.test");
await page.goto(`${ADMIN}/admins`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await row("adminhistory@swimsync.test")
  .getByRole("button", { name: "Delete", exact: true })
  .click();
await page.waitForTimeout(800);
await page.getByPlaceholder("DELETE").fill("DELETE");
await page.getByText("Delete account", { exact: true }).click();
await page.waitForTimeout(3000);

body = await page.evaluate(() => document.body.innerText);
// The RISK 11 wording: a sentence, not "audit_log.actor_id". The owner reads
// this, and after 20260813000400 it is the COMMON outcome, not a rare one.
check("the refusal names history in words, not a table name",
  body.includes("history recorded against their account") &&
  !body.includes("audit_log.actor_id"),
  body.slice(0, 300));

await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await page.goto(`${ADMIN}/admins`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
body = await page.evaluate(() => document.body.innerText);
check("the refused admin is STILL on the roster",
  body.includes("adminhistory@swimsync.test"));

// The compensation, which is the half a refusal could silently get wrong: the
// route bans BEFORE calling the RPC, so a refused delete that forgot to unban
// would leave a working admin locked out with no screen saying so.
check("a refused delete leaves the account able to sign in",
  await loginSticks("adminhistory@swimsync.test"));

// ── 9. The role gate: a plain coach is refused at the DOOR ──────────────────
// The login page signs a coach straight back out (and RequiresTenant repeats
// the refusal for any session that arrives another way) — so the pass here is
// staying on /login WITH the redirect copy, not a half-working panel.
check("a plain coach cannot enter the panel",
  !(await loginSticks("gatecoach@swimsync.test")));
body = await page.evaluate(() => document.body.innerText);
check("…and is pointed at the SwimSync app, not told 'access denied'",
  body.includes("use the SwimSync app"), body.slice(0, 300));
await page.screenshot({ path: shot("07-coach-gate.png"), fullPage: true });

await browser.close();

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
