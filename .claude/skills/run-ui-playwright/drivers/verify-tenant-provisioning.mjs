// Platform-admin tenant provisioning, end to end through the real UI.
//
// The load-bearing assertion is the LAST one: that the invited business owner
// can actually SIGN IN afterwards. A provisioning flow that creates rows but
// leaves its admin locked out is the exact failure that hit production when the
// tenancy backfill made the real coach a tenant_admin while login still branched
// on role === "coach" — they were met with "Unrecognised role" (HANDOVER §7.19).
// Capability follows which extension rows exist, not the enum, so this walks the
// whole path rather than checking the database.
//
// Setup: supabase running + seed; cd SwimSyncAdmin && npm run dev
import os from "node:os";
import path from "node:path";
import { launch, loginAdmin } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (name) => path.join(SHOT, name);
const results = [];
const check = (label, pass, detail = "") => {
  results.push({ pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const STAMP = Date.now();
const BIZ = `Dolphin Academy ${STAMP}`;
const ADMIN_EMAIL = `owner-${STAMP}@dolphin.test`;
const NEW_PASSWORD = "dolphin-pass-123";

const { browser, page } = await launch();
await loginAdmin(page, "superadmin@swimsync.test", "password123");
await page.goto("http://localhost:3000/platform");
await page.waitForTimeout(1500);

// ── 1. The form refuses mismatched emails ────────────────────────────────────
// This invite grants tenant_admin to whoever opens it, so a typo is a
// cross-tenant exposure rather than a bounced message.
await page.getByRole("button", { name: /New business/i }).click();
await page.waitForTimeout(400);
await page.getByPlaceholder("Dolphin Swim Academy").fill(BIZ);
await page.getByPlaceholder("Marcus Tan").fill("Dolphin Owner");
const emailInputs = page.locator('input[type="email"]');
await emailInputs.nth(0).fill(ADMIN_EMAIL);
await emailInputs.nth(1).fill("typo@dolphin.test");
await page.getByRole("button", { name: /Create & invite/i }).click();
await page.waitForTimeout(800);
check(
  "mismatched confirmation email is refused",
  /don't match/i.test(await page.innerText("body"))
);
await page.screenshot({ path: shot("prov-email-mismatch.png"), fullPage: true });

// ── 2. Provision for real ────────────────────────────────────────────────────
await emailInputs.nth(1).fill(ADMIN_EMAIL);
await page.getByRole("button", { name: /Create & invite/i }).click();
await page.waitForTimeout(2500);

const bodyAfter = await page.innerText("body");
check("the business is created", bodyAfter.includes(BIZ));

// The join code is the ONLY route into a business, so it must be shown at the
// moment of creation.
const codeMatch = bodyAfter.match(/SWIM-[A-Z2-9]{4}/);
check("a join code is shown on creation", Boolean(codeMatch), codeMatch?.[0] ?? "none found");

// Without RESEND_API_KEY the email cannot send — and because the email IS the
// deliverable here, that must surface as a warning with a copyable link rather
// than a green success. (With a key set, this flips to the "sent to" branch.)
const noKey = /No invite email was sent/i.test(bodyAfter);
const sentOk = /An invite to set a password was sent/i.test(bodyAfter);
check(
  "delivery outcome is stated explicitly (warning+link, or sent)",
  noKey || sentOk,
  noKey ? "warned + link shown" : "sent"
);
await page.screenshot({ path: shot("prov-created.png"), fullPage: true });

// ── 3. The new business shows its admin as INVITED, not active ───────────────
await page.reload();
await page.waitForTimeout(1800);
const rowText = await page
  .locator("tr", { hasText: BIZ })
  .first()
  .innerText()
  .catch(() => "");
check("the row names the admin", rowText.includes(ADMIN_EMAIL), rowText.slice(0, 120));
check("its status is 'invited' before they sign in", /invited/i.test(rowText));
check("a Resend action is offered while invited", /Resend/i.test(rowText));

// ── 4. Grab the invite link and accept it ───────────────────────────────────
// The link is only surfaced in the UI when sending failed; when a key IS set we
// mint a fresh one over the API instead, so this driver works either way.
const linkFromUi = bodyAfter.match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s"<]+/);
let inviteLink = linkFromUi?.[0] ?? null;

if (!inviteLink) {
  const token = await page.evaluate(async () => {
    const raw = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    return JSON.parse(localStorage.getItem(raw)).access_token;
  });
  const tenantId = await page.evaluate(async (biz) => {
    const rows = [...document.querySelectorAll("tr")];
    const r = rows.find((x) => x.innerText.includes(biz));
    return r ? r.getAttribute("data-tenant-id") : null;
  }, BIZ);
  if (tenantId) {
    const res = await fetch("http://localhost:3000/api/resend-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenantId }),
    });
    inviteLink = (await res.json()).inviteLink;
  }
}

check("an invite link is available to follow", Boolean(inviteLink));

if (inviteLink) {
  // The redirect must land on /accept-invite. If the URL is missing from
  // config.toml's additional_redirect_urls, Supabase SILENTLY substitutes
  // site_url and the owner lands on the admin root instead — the link still
  // "works", it just goes nowhere useful.
  check(
    "the invite redirects to /accept-invite (allow-list is correct)",
    inviteLink.includes("accept-invite"),
    inviteLink.slice(-60)
  );

  const ctx = await browser.newContext();
  const invitee = await ctx.newPage();
  await invitee.goto(inviteLink);
  await invitee.waitForTimeout(2500);

  const acceptBody = await invitee.innerText("body");
  check(
    "the invitee sees onboarding copy, not password-RESET copy",
    /Welcome to SwimSync/i.test(acceptBody) && !/Set New Password/i.test(acceptBody)
  );
  check("the page names the business being handed over", acceptBody.includes(BIZ), acceptBody.slice(0, 90));
  await invitee.screenshot({ path: shot("prov-accept-invite.png"), fullPage: true });

  await invitee.locator('input[type="password"]').nth(0).fill(NEW_PASSWORD);
  await invitee.locator('input[type="password"]').nth(1).fill(NEW_PASSWORD);
  await invitee.getByRole("button", { name: /Set Password & Continue/i }).click();
  await invitee.waitForTimeout(2500);
  check("the password is accepted", /You&apos;re all set|You're all set/i.test(await invitee.innerText("body")));

  // ── 5. THE ONE THAT MATTERS: they can actually sign in ────────────────────
  await invitee.goto("http://localhost:3000/login");
  await invitee.waitForTimeout(800);
  await invitee.fill('input[type="email"]', ADMIN_EMAIL);
  await invitee.fill('input[type="password"]', NEW_PASSWORD);
  await invitee.click('button[type="submit"]');
  await invitee.waitForTimeout(3000);

  const landed = invitee.url();
  const afterLogin = await invitee.innerText("body");
  check(
    "the new admin can SIGN IN to the admin panel",
    !/Unrecognised role|Invalid login/i.test(afterLogin) && !landed.includes("/login"),
    landed
  );
  // They administer ONE business — their own — and must not see the platform
  // page, which belongs to SwimSync itself.
  check(
    "they land inside their own business, not the platform view",
    !landed.includes("/platform"),
    landed
  );
  await invitee.screenshot({ path: shot("prov-new-admin-signed-in.png"), fullPage: true });

  // ── 6. Their status flips to active ──────────────────────────────────────
  await page.reload();
  await page.waitForTimeout(1800);
  const rowNow = await page
    .locator("tr", { hasText: BIZ })
    .first()
    .innerText()
    .catch(() => "");
  check("the platform row now reads 'active'", /active/i.test(rowNow) && !/invited/i.test(rowNow), rowNow.slice(0, 120));

  await ctx.close();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
