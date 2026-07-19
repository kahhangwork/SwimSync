// Drives address + postal code: collected at signup, editable afterwards.
//
// The editable-afterwards half is the point. Both fields are OPTIONAL at
// registration and every existing parent predates them, so without a later
// edit path the feature would only ever hold data for families who joined
// after it shipped — not the families the coach is trying to reach.
//
//   node drivers/verify-parent-address.mjs        (needs a clean-ish DB)
import { launch, tap, EXPO } from "./lib.mjs";

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

const EMAIL = `addr-${Date.now()}@test.local`;
const { browser, page } = await launch({ mobile: true, headless: true });

try {
  console.log("\n[parent] register with an address");
  // Reached via the login screen's Register link, not by URL: direct
  // navigation to a nested route redirects to the app root (SKILL.md gotcha 8).
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await tap(page.getByText("Register"), "Register link");
  await page.waitForTimeout(3000);

  await page.getByPlaceholder("Sarah Tan").fill("Address Tester");
  // .last(): the login screen stays mounted underneath, so its email
  // field also matches (SKILL.md gotcha 6).
  await page.getByPlaceholder("you@email.com").last().fill(EMAIL);
  await page.getByPlaceholder("+65 9123 4567").fill("+65 9000 0000");
  await page.getByPlaceholder("Blk 123 Clementi Ave 3, #04-56").fill("Blk 9 Test Road");

  // A 5-digit code must be refused BEFORE the account is created — otherwise
  // the guard is untestable without leaving a junk auth user behind.
  await page.getByPlaceholder("120123").fill("12345");
  const pwds = page.locator('input[type="password"]');
  const nPwd = await pwds.count();
  // Last two are the register screen's password + confirm.
  await pwds.nth(nPwd - 2).fill("password123");
  await pwds.nth(nPwd - 1).fill("password123");
  await page.getByText("Create Account").last().click({ force: true });
  await page.waitForTimeout(1500);

  const bad = await page.evaluate(() => document.body.innerText);
  check(/Postal code should be 6 digits/.test(bad),
    "a 5-digit postal code is refused before the account is created",
    bad.match(/Postal[^\n]*/)?.[0]);

  // The real thing, with a LEADING ZERO — the reason the column is TEXT.
  await page.getByPlaceholder("120123").fill("018956");
  await page.getByText("Create Account").last().click({ force: true });
  await page.waitForTimeout(6000);

  const after = await page.evaluate(() => document.body.innerText);
  check(!/Postal code should be/.test(after), "a valid 6-digit code is accepted");
  check(/Welcome|My Children|Join your coach/i.test(after),
    "registration completed and landed in the app",
    after.slice(0, 120));

  console.log("\n[parent] the saved details come back on the profile screen");
  await tap(page.getByText("Profile").last(), "Profile tab");
  await page.waitForTimeout(2000);
  await tap(page.getByText("Contact Details", { exact: true }), "Contact Details");
  await page.waitForTimeout(3000);

  const addrVal = await page.getByPlaceholder("Blk 123 Clementi Ave 3, #04-56").inputValue();
  const postalVal = await page.getByPlaceholder("120123").inputValue();
  check(addrVal === "Blk 9 Test Road",
    "the address saved at signup is loaded back", `address = "${addrVal}"`);
  check(postalVal === "018956",
    "the LEADING ZERO survived — the column is TEXT, not an integer",
    `postal = "${postalVal}"`);

  console.log("\n[parent] editing afterwards (the backfill path)");
  await page.getByPlaceholder("120123").fill("120123");
  await tap(page.getByText("Save", { exact: true }), "Save");
  await page.waitForTimeout(3000);

  const stillOnForm = await page
    .getByPlaceholder("Blk 123 Clementi Ave 3, #04-56")
    .isVisible()
    .catch(() => false);
  check(!stillOnForm, "a valid edit saves and closes the form");

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: "/tmp/address-error.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
