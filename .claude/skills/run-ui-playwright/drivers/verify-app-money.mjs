// verify-app-money.mjs — the parent money actions no other driver presses.
//
// WHY THIS EXISTS. Promoted from the App L-G hand-check
// (docs/refactor/app-fgh-handchecks-G.mjs), proven on the pre-refactor AND the
// refactored Billing. verify-parent-pay-claim claims from the invoice LIST; these
// are the other doors:
//   A. Invoice Detail's own "I've paid" (claim_invoice_paid) — ONE confirm, the
//      claimed line, status stays outstanding, survives a reload.
//   B. Billing → Packages: the referral card shows the code, and Copy fires.
//   C. "Request & pay" → one PENDING package → its tokenized /package/<token>
//      page renders price + a data:image QR + "I've paid", logged IN and logged
//      OUT, and no request to public-package carries an auth header (§7.264 —
//      a non-safelisted header forces a CORS preflight the function refuses).
//   D. Billing → Packages → Cancel on that request (cancelRequest) → cancelled.
//
// Setup:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-app-money.sql
//   Expo web on :8081 (or EXPO_URL); `supabase functions serve` (public-package).
//
// Persona: app-money-parent@swimsync.test (password123) — sole parent of the
// fixture's own tenant "App Money Swim", one outstanding invoice INV-2026-9931,
// referral code REF-APPM1, one product "App Money 4-Pack".

import os from "node:os";
import { execSync } from "node:child_process";
import { launch, loginExpo, pressByText, EXPO } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/app-money-${n}.png`;
const TENANT = "ac300000-0000-0000-0000-000000000001";
const INVOICE = "ac300000-0000-0000-0000-0000000000c1";
const PARENT = "app-money-parent@swimsync.test";
const AUTH_HEADERS = ["authorization", "apikey", "x-client-info"];

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"`)
    .toString()
    .trim();
const waitOk = (p) => p.then(() => true).catch(() => false);
/** Record the header NAMES of every public-package request the page makes. */
const recordPublicPackage = (page, into) =>
  page.on("request", (r) => {
    if (r.url().includes("/functions/v1/public-package")) into.push(Object.keys(r.headers()).map((h) => h.toLowerCase()));
  });

const pre = psql(
  `SELECT (SELECT count(*) FROM invoices WHERE id = '${INVOICE}' AND status = 'outstanding' AND paid_claimed_at IS NULL)
     || '|' || (SELECT count(*) FROM parent_packages WHERE tenant_id = '${TENANT}')
     || '|' || (SELECT count(*) FROM parent_tenants WHERE tenant_id = '${TENANT}' AND referral_code = 'REF-APPM1')`
);
if (pre !== "1|0|1") {
  console.error(`✗ fixture not in its starting state (invoice|packages|referral = ${pre}, want 1|0|1) — load fixtures-app-money.sql`);
  process.exit(1);
}

const browsers = [];
try {
  // ── A. Invoice Detail "I've paid" ─────────────────────────────────────────
  {
    const { browser, page } = await launch();
    browsers.push(browser);
    // ⚠ RECORD ONLY — launch() already accepts every dialog; a second accepting
    // handler throws "already handled" (see verify-parent-pay-claim.mjs).
    const dialogs = [];
    page.on("dialog", (d) => dialogs.push(d.message()));
    await loginExpo(page, PARENT);
    // Reached by TAP — a deep link leaves the target hidden under Home (§7.254),
    // and pressByText only presses what is visible.
    const openDetail = async () => {
      await pressByText(page, "Billing");
      await page.waitForTimeout(3000);
      await pressByText(page, "View Details");
      await page.getByText("Invoice Detail").last().waitFor({ timeout: 30000 });
      await page.waitForTimeout(2500);
    };
    await openDetail();
    await pressByText(page, "I've paid");
    await page.getByText(/You've told your coach this is paid/).first().waitFor({ timeout: 15000 }).catch(() => {});
    check("A: exactly one confirm dialog", dialogs.length === 1, JSON.stringify(dialogs));
    check("A: the claimed line replaces the button", (await page.getByText(/You've told your coach this is paid/).count()) > 0);
    check("A: invoices.paid_claimed_at is set", psql(`SELECT paid_claimed_at IS NOT NULL FROM invoices WHERE id = '${INVOICE}'`) === "t");
    check(
      "A: status stays outstanding (a claim, not a payment)",
      psql(`SELECT status FROM invoices WHERE id = '${INVOICE}'`) === "outstanding"
    );
    await page.goto(`${EXPO}/home`, { waitUntil: "domcontentloaded" });
    await page.getByText("Welcome back,").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await openDetail();
    check("A: …and survives a reload", (await page.getByText(/You've told your coach this is paid/).count()) > 0);
    await page.screenshot({ path: shot("A-claimed") });
    await browser.close();
  }

  // ── B + C + D ─────────────────────────────────────────────────────────────
  {
    const { browser, page } = await launch();
    browsers.push(browser);
    await loginExpo(page, PARENT);
    await pressByText(page, "Billing");
    await page.waitForTimeout(2500);
    await pressByText(page, "Packages");
    await page.getByText("Your referral code").first().waitFor({ timeout: 20000 }).catch(() => {});
    check("B: the referral card shows the code", (await page.getByText("REF-APPM1").count()) > 0);
    await pressByText(page, "Copy");
    // Headless Chrome may refuse the clipboard; either Toast proves the press ran.
    const copied = page.getByText(/Referral code copied\.|Long-press the code to copy it\./).first();
    check("B: Copy fires its Toast", await waitOk(copied.waitFor({ timeout: 8000 })));
    await page.screenshot({ path: shot("B-referral") });

    // ── C. request → the PayNow screen ──
    await pressByText(page, "Request & pay");
    await page.waitForURL(/paynow\?packageId=/, { timeout: 20000 }).catch(() => {});
    check("C: Request & pay lands on the PayNow screen", /paynow\?packageId=/.test(page.url()), page.url());
    const pending = psql(`SELECT count(*) FROM parent_packages WHERE tenant_id = '${TENANT}' AND status = 'pending'`);
    check("C: exactly one PENDING package request was created", pending === "1", pending);
    const token = psql(
      `SELECT coalesce(public_token, '') FROM parent_packages WHERE tenant_id = '${TENANT}' AND status = 'pending' ORDER BY requested_at DESC LIMIT 1`
    );
    check("C: the request carries a public token", /^[0-9a-f]{32}$/.test(token), token);

    // ── C. the tokenized page, logged IN ──
    const inHeaders = [];
    recordPublicPackage(page, inHeaders);
    await page.goto(`${EXPO}/package/${token}`, { waitUntil: "domcontentloaded" });
    await page.getByText(/Reference: PKG-/).first().waitFor({ timeout: 30000 }).catch(() => {});
    const inText = await page.evaluate(() => document.body.innerText);
    check("C (logged in): price + PKG reference render", /\$\d+\.\d\d/.test(inText) && /Reference: PKG-/.test(inText));
    check("C (logged in): a data:image QR renders", (await page.locator('img[src^="data:image"]').count()) > 0);
    check("C (logged in): I've paid is offered", /I've paid/.test(inText));
    await page.screenshot({ path: shot("C-in") });

    // ── C. the tokenized page, logged OUT — a second, fresh browser, while the offer is still pending
    {
      const out = await launch();
      browsers.push(out.browser);
      const outHeaders = [];
      recordPublicPackage(out.page, outHeaders);
      await out.page.goto(`${EXPO}/package/${token}`, { waitUntil: "domcontentloaded" });
      await out.page.getByText(/Reference: PKG-/).first().waitFor({ timeout: 30000 }).catch(() => {});
      const t = await out.page.evaluate(() => document.body.innerText);
      check("C (logged out): the offer renders, not 'Package not found'", /Reference: PKG-/.test(t) && !/Package not found/.test(t));
      check("C (logged out): a data:image QR renders", (await out.page.locator('img[src^="data:image"]').count()) > 0);
      const extra = outHeaders.flat().filter((h) => AUTH_HEADERS.includes(h));
      check("C (logged out): public-package requests carry no auth header", outHeaders.length > 0 && extra.length === 0, `${outHeaders.length} req, extra: ${extra.join(",") || "none"}`);
      await out.page.screenshot({ path: shot("C-out") });
      await out.browser.close();
    }
    // Logged in is the case that matters: the app HAS a session to leak into the call.
    {
      const extra = inHeaders.flat().filter((h) => AUTH_HEADERS.includes(h));
      check("C (logged in): public-package requests carry no auth header", inHeaders.length > 0 && extra.length === 0, `${inHeaders.length} req, extra: ${extra.join(",") || "none"}`);
    }

    // ── D. cancel the request from Billing ──
    await page.goto(`${EXPO}/home`, { waitUntil: "domcontentloaded" });
    await page.getByText("Welcome back,").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await pressByText(page, "Billing");
    await page.waitForTimeout(3000);
    await pressByText(page, "Packages");
    await page.waitForTimeout(2000);
    check("D: the pending request offers Cancel", await pressByText(page, "Cancel"));
    await page.waitForTimeout(3000);
    check(
      "D: Cancel sets the request to cancelled",
      psql(`SELECT status FROM parent_packages WHERE public_token = '${token}'`) === "cancelled"
    );
    await page.screenshot({ path: shot("D-cancelled") });
    await browser.close();
  }
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
