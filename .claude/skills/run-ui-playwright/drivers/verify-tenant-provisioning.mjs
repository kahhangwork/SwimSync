// Platform-admin tenant provisioning, end to end through the real UI.
//
// The load-bearing assertion is the LAST one: that the invited business owner
// can actually SIGN IN afterwards. A provisioning flow that creates rows but
// leaves its admin locked out is the exact failure that hit production when the
// tenancy backfill made the real coach a tenant_admin while login still branched
// on role === "coach" — they were met with "Unrecognised role" (`docs/GOTCHAS.md` §7.19).
// Capability follows which extension rows exist, not the enum, so this walks the
// whole path rather than checking the database.
//
// Setup: supabase running + seed; cd SwimSyncAdmin && npm run dev
// PRECONDITION: RESEND_API_KEY must be UNSET (neither CI nor a local stack sets
// it). With a key set the invite link is emailed instead of shown, and the last
// SEVEN checks cannot run — the driver says so and fails rather than skipping.
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

// ⚠ WAIT FOR THE OUTCOME, NEVER FOR A DURATION. This was `waitForTimeout(2500)`
// and it went red on the nightly of 2026-08-29 (5/8) while passing locally at
// 15/15: provisioning is an API-route round trip that also mints an auth invite
// link, and on a cold CI runner the route's first compile alone outlasts the
// budget. The run's own screenshot showed the button still reading "Creating…".
// A fixed sleep turns a slow machine into a fake product failure — and here it
// cost the SEVEN checks below, which are the ones this driver exists for.
await page
  .waitForFunction(
    (biz) => {
      const t = document.body.innerText;
      return (
        t.includes(`${biz} is set up`) ||
        /Could not create|Could not invite|already administers|already in use/i.test(t)
      );
    },
    BIZ,
    { timeout: 30000 }
  )
  .catch(() => {});

// ⚠ READ THE PANEL, NOT THE PAGE. Everything below used to match against the
// whole body, which also contains the businesses TABLE — including the seed's
// own join code. That is why the join-code check PASSED on the red run while
// reporting `SWIM-TEST`: a seed row the driver does not own, asserted as if it
// were the new business's code (§7.75, §7.101). Scoping to the success panel
// makes a missing panel fail every check that depends on it, together.
const panelText = await page
  .locator(`xpath=//h3[contains(., "${BIZ} is set up")]/..`)
  .innerText()
  .catch(() => "");

check("the business is created", panelText.includes(BIZ), panelText ? "panel shown" : "no success panel");

// The join code is the ONLY route into a business, so it must be shown at the
// moment of creation.
const codeMatch = panelText.match(/SWIM-[A-Z2-9]{4}/);
check("a join code is shown on creation", Boolean(codeMatch), codeMatch?.[0] ?? "none found");

// Without RESEND_API_KEY the email cannot send — and because the email IS the
// deliverable here, that must surface as a warning with a copyable link rather
// than a green success. (With a key set, this flips to the "sent to" branch.)
const noKey = /No invite email was sent/i.test(panelText);
const sentOk = /An invite to set a password was sent/i.test(panelText);
check(
  "delivery outcome is stated explicitly (warning+link, or sent)",
  noKey || sentOk,
  // Say what was actually seen. This used to print "sent" whenever the no-key
  // branch was absent — including on failure, where nothing had been sent at
  // all — which is what sent the first triage of this red down the wrong path.
  noKey ? "warned + link shown" : sentOk ? "sent" : "NEITHER — no outcome rendered"
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
// The link is surfaced in the UI ONLY when sending failed — with a key set the
// route deliberately returns `inviteLink: null`, because a link that was emailed
// should not also be printed on a screen.
//
// ⚠ THIS DRIVER THEREFORE REQUIRES `RESEND_API_KEY` TO BE UNSET, and says so
// out loud rather than quietly skipping. It used to claim it "works either way"
// via a fallback that minted a fresh link over /api/resend-invite — but that
// fallback read `data-tenant-id` off the table row, an attribute that exists
// NOWHERE in the admin panel, so `tenantId` was always null, the fetch never
// ran, and `inviteLink` stayed null. The seven checks below — including the one
// this file's own header calls load-bearing, that the invited owner can SIGN IN
// — were skipped silently whenever the link was missing for ANY reason. That is
// §7.100's shape: a driver quietly not asserting the thing it exists to assert.
// Neither CI nor a local stack sets the key, so the precondition costs nothing;
// what it buys is a loud, named failure instead of a short green run.
const linkFromUi = panelText.match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s"<]+/);
const inviteLink = linkFromUi?.[0] ?? null;

check(
  "an invite link is available to follow",
  Boolean(inviteLink),
  inviteLink
    ? "from the warning panel"
    : panelText
    ? "panel shown but no link — is RESEND_API_KEY set? this driver needs it UNSET"
    : "no success panel at all, so nothing to read a link from"
);

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
} else {
  // Say the quiet part. Without this the run reports "5/8" and a reader has to
  // know that a full pass is FIFTEEN to notice that the seven checks this file
  // exists for — accept the invite, set a password, sign in, land in the right
  // business — never executed at all. A shrinking denominator is not a signal
  // anyone reads (§7.100).
  console.log(
    "\n  ⚠ SKIPPED the 7 checks after this one — no invite link, so the " +
      "accept-invite → set-password → SIGN-IN path was never exercised. " +
      `That path is why this driver exists. A full pass is ${results.length + 7}; ` +
      `this run only ever reached ${results.length} — read it as unverified, not as a partial pass.`
  );
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
