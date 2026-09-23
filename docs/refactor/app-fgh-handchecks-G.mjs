// Hand-checks for App L-G (docs/refactor/BATCH_FGH_PLAN.md, ⚠ R2 + R5): the money
// actions no verify-* driver presses.
//   A. Invoice Detail's own "I've paid" (claim_invoice_paid) — one confirm, the claimed
//      line, survives a reload.
//   B. Billing → Packages: the referral card renders the code, and Copy fires.
//   C. "Request & pay" → a PENDING package → its tokenized /package/<token> page renders
//      price + a data:image QR + "I've paid", logged OUT and logged IN, and every request
//      to the public-package function carries content-type ONLY (R2 — CORS).
//   D. Billing → Packages → Cancel on that pending request (cancelRequest) → cancelled.
// Run from .claude/skills/run-ui-playwright/drivers/ (copy it there) after a db reset +
// fixtures-payment-collection.sql + fixtures-packages.sql. Fixture writes THROW (§7.251).
import { launch, loginExpo, pressByText, EXPO } from "./lib.mjs";
import { execSync } from "node:child_process";

const SHOT = process.env.SHOTDIR ?? "/tmp";
const TAG = process.env.TAG ?? "hc";
const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"`)
    .toString()
    .trim();
const res = [];
const check = (ok, msg) => res.push(`${ok ? "PASS" : "FAIL"} ${msg}`);
const INVOICE = "da100000-0000-0000-0000-0000000000c1";
const MARCUS = "70000000-0000-0000-0000-000000000001";

// Fixture: a PayNow ID so a dynamic QR can be built, and a referral code on the
// packages parent's membership.
psql(`UPDATE tenants SET paynow_mobile = '91234567' WHERE id = '${MARCUS}'`);
psql(
  `UPDATE parent_tenants SET referral_code = 'REF-HCG01' WHERE tenant_id = '${MARCUS}'
     AND parent_id = (SELECT p.id FROM parents p JOIN auth.users u ON u.id = p.profile_id WHERE u.email = 'parent-pkg@swimsync.test')`
);
check(psql(`SELECT count(*) FROM parent_tenants WHERE referral_code = 'REF-HCG01'`) === "1", "fixture: referral code set");

// ── A. Invoice Detail "I've paid" ─────────────────────────────────────────
{
  const { browser, page } = await launch();
  let dialogs = 0;
  page.on("dialog", () => dialogs++); // lib's own handler accepts it
  await loginExpo(page, "pay-driver-parent@swimsync.test");
  // Reached by TAP — a deep link leaves the target hidden under Home (§7.254), and
  // pressByText only presses what is visible.
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
  check(dialogs === 1, `exactly one confirm dialog (${dialogs})`);
  check((await page.getByText(/You've told your coach this is paid/).count()) > 0, "the claimed line replaces the button");
  check(psql(`SELECT paid_claimed_at IS NOT NULL FROM invoices WHERE id = '${INVOICE}'`) === "t", "invoices.paid_claimed_at is set");
  check(psql(`SELECT status FROM invoices WHERE id = '${INVOICE}'`) === "outstanding", "status stays outstanding (a claim, not a payment)");
  await page.goto(`${EXPO}/home`, { waitUntil: "domcontentloaded" });
  await page.getByText("Welcome back,").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await openDetail();
  check((await page.getByText(/You've told your coach this is paid/).count()) > 0, "…and survives a reload");
  await page.screenshot({ path: `${SHOT}/hcG-${TAG}-A-claimed.png` });
  await browser.close();
}

// ── B + C(request) + D ────────────────────────────────────────────────────
let token = "";
{
  const { browser, page } = await launch();
  await loginExpo(page, "parent-pkg@swimsync.test");
  await pressByText(page, "Billing");
  await page.waitForTimeout(2500);
  await pressByText(page, "Packages");
  await page.getByText("Your referral code").first().waitFor({ timeout: 20000 }).catch(() => {});
  check((await page.getByText("REF-HCG01").count()) > 0, "B: the referral card shows the code");
  await pressByText(page, "Copy");
  const copied = page.getByText(/Referral code copied\.|Long-press the code to copy it\./).first();
  check(await copied.waitFor({ timeout: 8000 }).then(() => true).catch(() => false), "B: Copy fires its Toast");
  await page.screenshot({ path: `${SHOT}/hcG-${TAG}-B-referral.png` });

  const before = Number(psql(`SELECT count(*) FROM parent_packages WHERE status = 'pending'`));
  await pressByText(page, "Request & pay");
  await page.waitForURL(/paynow\?packageId=/, { timeout: 20000 }).catch(() => {});
  check(/paynow\?packageId=/.test(page.url()), `C: Request & pay lands on the PayNow screen (${page.url()})`);
  const after = Number(psql(`SELECT count(*) FROM parent_packages WHERE status = 'pending'`));
  check(after === before + 1, "C: one PENDING package request was created");
  token = psql(`SELECT public_token FROM parent_packages WHERE status = 'pending' ORDER BY requested_at DESC LIMIT 1`);
  check(/^[0-9a-f]{32}$/.test(token), "C: the request carries a public token");

  // ── C. the tokenized page, logged IN ──
  const headers = [];
  page.on("request", (r) => {
    if (r.url().includes("/functions/v1/public-package")) headers.push(Object.keys(r.headers()).map((h) => h.toLowerCase()));
  });
  await page.goto(`${EXPO}/package/${token}`, { waitUntil: "domcontentloaded" });
  await page.getByText(/Reference: PKG-/).first().waitFor({ timeout: 30000 }).catch(() => {});
  const inText = await page.evaluate(() => document.body.innerText);
  check(/\$\d+\.\d\d/.test(inText) && /Reference: PKG-/.test(inText), "C (logged in): price + PKG reference render");
  check((await page.locator('img[src^="data:image"]').count()) > 0, "C (logged in): a data:image QR renders");
  check(/I've paid/.test(inText), "C (logged in): I've paid is offered");
  await page.screenshot({ path: `${SHOT}/hcG-${TAG}-C-in.png` });

  // ── C. the tokenized page, logged OUT — a second, fresh browser, while the offer is still pending
  {
    const { browser, page } = await launch();
    const headers = [];
    page.on("request", (r) => {
      if (r.url().includes("/functions/v1/public-package")) headers.push(Object.keys(r.headers()).map((h) => h.toLowerCase()));
    });
    await page.goto(`${EXPO}/package/${token}`, { waitUntil: "domcontentloaded" });
    await page.getByText(/Reference: PKG-/).first().waitFor({ timeout: 30000 }).catch(() => {});
    const t = await page.evaluate(() => document.body.innerText);
    check(/Reference: PKG-/.test(t) && !/Package not found/.test(t), "C (logged out): the offer renders, not 'Package not found'");
    check((await page.locator('img[src^="data:image"]').count()) > 0, "C (logged out): a data:image QR renders");
    const extra = headers.flat().filter((h) => ["authorization", "apikey", "x-client-info"].includes(h));
    check(headers.length > 0 && extra.length === 0, `C (logged out): no auth headers (${headers.length} req)`);
    await page.screenshot({ path: `${SHOT}/hcG-${TAG}-C-out.png` });
    await browser.close();
  }

  // ── D. cancel the request from Billing ──
  await page.goto(`${EXPO}/home`, { waitUntil: "domcontentloaded" });
  await page.getByText("Welcome back,").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await pressByText(page, "Billing");
  await page.waitForTimeout(3000);
  await pressByText(page, "Packages");
  await page.waitForTimeout(2000);
  await pressByText(page, "Cancel");
  await page.waitForTimeout(3000);
  check(psql(`SELECT status FROM parent_packages WHERE public_token = '${token}'`) === "cancelled", "D: Cancel sets the request to cancelled");
  await page.screenshot({ path: `${SHOT}/hcG-${TAG}-D-cancelled.png` });
  await browser.close();

  // The page must not have sent anything beyond the CORS-safelisted set.
  const extra = headers.flat().filter((h) => ["authorization", "apikey", "x-client-info"].includes(h));
  check(headers.length > 0 && extra.length === 0, `C: public-package requests carry no auth headers (${headers.length} req, extra: ${extra.join(",") || "none"})`);
}

console.log(res.join("\n"));
console.log(`${res.filter((r) => r.startsWith("PASS")).length}/${res.length} hand-checks passed`);
process.exit(res.every((r) => r.startsWith("PASS")) ? 0 : 1);
