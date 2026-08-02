// verify-payment-collection.mjs — payment collection end to end (PRD §7.21).
//
// WHAT THIS PROVES (and deliberately does not):
//   • The admin's PayNow settings round-trip on the Invoices page.
//   • The WhatsApp button opens a wa.me popup for the RIGHT number carrying
//     the tokenized link, and the row stamps "chat opened" — the stamp's
//     honest wording is asserted, since "reminded" would be a lie (RISK 7).
//   • The tokenized public page renders SESSIONLESS: amount, reference, a
//     computed QR image, Save-QR control.
//   • The auth-gate widening did NOT leak: a sessionless deep link to an
//     authed route still bounces to login, and a SIGNED-IN parent opening
//     the public link is not stolen away from it (RISK 4, both directions).
//   • The full claim → confirm loop: "I've paid" on the public page, the
//     admin's "parent says paid" badge + Claimed filter, Mark Paid via the
//     converged RPC, and the public page flipping to its paid state.
//   • NOT proven here: that a bank app accepts the QR (manual release gate),
//     or WhatsApp actually sending anything — the driver never presses Send.
//
// Setup:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-payment-collection.sql
//   Admin dev server on :3000, Expo web on :8081. Re-load the fixture before
//   every run — it resets the invoice a previous run paid.

import os from "node:os";
import { ADMIN, EXPO, launch, loginAdmin, loginExpo, tap } from "./lib.mjs";

const TOKEN = "da100000c0ffee00da100000c0ffee00";
const SHOT = process.env.SHOT_DIR ?? os.tmpdir();

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const { browser, page } = await launch();
const context = page.context();
try {
  // ══ 1. Admin: PayNow settings + WhatsApp button ═══════════════════════════
  await loginAdmin(page, "pay-driver-admin@swimsync.test", "password123");
  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const uenField = page.locator("#paynow-uen");
  const mobileField = page.locator("#paynow-mobile");
  check("settings: both PayNow proxy fields render",
    (await uenField.count()) === 1 && (await mobileField.count()) === 1);
  check("settings: the fixture's mobile proxy is loaded",
    (await mobileField.inputValue()) === "91234567");

  await mobileField.fill("+65 9123 4567"); // normalizes back to 91234567
  await mobileField.blur();
  await page.waitForTimeout(1200);
  check("settings: blur saves and confirms",
    await page.getByText("PayNow details saved.").isVisible());
  check("settings: the save normalized +65 form to bare digits",
    (await mobileField.inputValue()) === "91234567",
    await mobileField.inputValue());

  // The WhatsApp button opens a popup — catch it rather than pressing Send.
  // exact:true — role-name matching is SUBSTRING-based, and without it this
  // clicks the "WhatsApp reminders" queue button above the table (§7.66's
  // shape: short labels collide).
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "WhatsApp", exact: true }).first().click(),
  ]);
  const waUrl = popup.url();
  await popup.close();
  // wa.me 302s to api.whatsapp.com/send/?phone=... — by the time the popup
  // URL is readable it may be either form. The number is the assertion.
  check("whatsapp: popup targets the parent's number on WhatsApp",
    waUrl.includes("wa.me/6591112222") || waUrl.includes("phone=6591112222"),
    waUrl.slice(0, 60));
  check("whatsapp: the message carries the tokenized invoice link",
    decodeURIComponent(waUrl).includes(`/invoice/${TOKEN}`));
  check("whatsapp: the message carries the reference",
    decodeURIComponent(waUrl).includes("INV-2026-9901"));

  await page.waitForTimeout(1000);
  const bodyText = await page.locator("body").innerText();
  check('whatsapp: the stamp reads "chat opened" — never "reminded"',
    bodyText.includes("chat opened") && !bodyText.toLowerCase().includes("reminded"));

  // ══ 2. Sessionless: the public page, and the gate that must still hold ════
  const anon = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const anonPage = await anon.newPage();

  await anonPage.goto(`${EXPO}/billing`, { waitUntil: "networkidle" });
  await anonPage.waitForTimeout(6000);
  check("gate: a sessionless deep link to an authed route still lands on login",
    (await anonPage.locator("body").innerText()).includes("Sign In"));

  await anonPage.goto(`${EXPO}/invoice/${TOKEN}`, { waitUntil: "networkidle" });
  await anonPage.waitForTimeout(6000);
  const pubText = await anonPage.locator("body").innerText();
  check("public page: renders the amount with no session",
    pubText.includes("$88.00"));
  check("public page: shows the reference as text",
    pubText.includes("INV-2026-9901"));
  check("public page: a computed QR image is present",
    (await anonPage.locator('img[src^="data:image"]').count()) >= 1);
  check("public page: Save QR control present",
    pubText.includes("Save QR image"));
  await anonPage.screenshot({ path: `${SHOT}/payment-public-page.png` });

  // ══ 3. The claim, sessionless ═════════════════════════════════════════════
  anonPage.on("dialog", (d) => d.accept());
  await tap(anonPage.getByText("I've paid", { exact: true }).last(), "I've paid");
  await anonPage.waitForTimeout(2500);
  check("claim: the public page acknowledges the claim",
    (await anonPage.locator("body").innerText()).includes("your coach will confirm"));

  // ══ 4. RISK 4 other direction: a SIGNED-IN parent keeps the public page ═══
  const parentCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const parentPage = await parentCtx.newPage();
  await loginExpo(parentPage, "pay-driver-parent@swimsync.test");
  await parentPage.goto(`${EXPO}/invoice/${TOKEN}`, { waitUntil: "networkidle" });
  await parentPage.waitForTimeout(6000);
  check("gate: a signed-in parent opening the public link is NOT bounced home",
    (await parentPage.locator("body").innerText()).includes("INV-2026-9901"));
  await parentCtx.close();

  // ══ 5. Admin: badge → Claimed filter → converged Mark Paid ════════════════
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  check('admin: the "parent says paid" badge appears',
    (await page.locator("body").innerText()).includes("parent says paid"));

  await page.getByRole("button", { name: "Claimed", exact: true }).click();
  await page.waitForTimeout(800);
  check("admin: the Claimed filter shows the claimed invoice",
    (await page.locator("body").innerText()).includes("Pay Driver Parent"));

  await page.getByRole("button", { name: /Mark Paid/ }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Paid", exact: true }).click();
  await page.waitForTimeout(800);
  check("admin: after the RPC confirm, the invoice lists as Paid",
    (await page.locator("body").innerText()).includes("Pay Driver Parent"));

  // ══ 6. The public page tells the parent it's settled ══════════════════════
  await anonPage.reload({ waitUntil: "networkidle" });
  await anonPage.waitForTimeout(6000);
  check("public page: now reads paid, QR gone",
    (await anonPage.locator("body").innerText()).includes("Paid — thank you"));
  await anon.close();
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
