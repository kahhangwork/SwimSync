import { launch, loginExpo, tap, dumpText } from "./lib.mjs";

const OUT = process.env.SHOT_DIR || "/tmp";

const { browser, page } = await launch();
// launch() in lib.mjs already registers a dialog handler that accepts the
// web window.confirm() fired by confirmAction() — don't add a second one.

try {
  await loginExpo(page, "coach@swimsync.test", "password123");
  console.log("logged in as coach");

  // Navigate to Billing tab like a user
  await tap(page.locator('a[href="/billing"]'), "Billing tab");
  await page.waitForTimeout(2500);

  const before = await dumpText(page);
  console.log("=== BILLING (before) ===");
  console.log(before.slice(0, 800));
  await page.screenshot({ path: `${OUT}/coach-billing-before.png` });

  const hasInvoice = before.includes("Julia Chan") && before.includes("25.00");
  const hasOutstanding = before.includes("Outstanding");
  console.log("invoice visible:", hasInvoice, "| outstanding shown:", hasOutstanding);

  // Click Mark Paid (RN-web touchable → force click)
  await tap(page.getByText("Mark Paid"), "Mark Paid button");
  await page.waitForTimeout(3000);

  const after = await dumpText(page);
  console.log("=== BILLING (after) ===");
  console.log(after.slice(0, 800));
  await page.screenshot({ path: `${OUT}/coach-billing-after.png` });

  const noMoreButton = !after.includes("Mark Paid");
  const showsPaid = after.includes("Paid");
  console.log("mark-paid button gone:", noMoreButton, "| shows Paid:", showsPaid);
} catch (e) {
  console.error("ERROR:", e.message);
  await page.screenshot({ path: `${OUT}/coach-billing-error.png` });
} finally {
  await browser.close();
}
