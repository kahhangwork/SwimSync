// Phase 4: does a parent dealing with TWO businesses see whose bill is whose,
// and get the right payee?
//
// This is the case the old UNIQUE (parent_id, billing_month) forbade outright,
// and the one the user expects to be common. The failure it guards against is
// specific and expensive: paying the wrong business because the PayNow QR came
// from the coach who taught the lesson rather than the business that billed it.
//
// Prereqs: supabase start · db reset · expo web on :8081.
import { launch, tap, EXPO } from "./lib.mjs";
import { execSync } from "node:child_process";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const EMAIL = "phase4-parent@test.local";
const { browser, page } = await launch({ mobile: true, headless: true });

try {
  // Register the parent through the real UI, then attach the fixture to them.
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  await tap(page.getByText("Register").last(), "register link");
  await page.waitForTimeout(5000);
  await page.getByPlaceholder("Sarah Tan").last().fill("Phase4 Parent");
  await page.getByPlaceholder("you@email.com").last().fill(EMAIL);
  await page.getByPlaceholder("+65 9123 4567").last().fill("+65 91234567");
  const pw = page.locator('input[type="password"]');
  const n = await pw.count();
  await pw.nth(n - 2).fill("password123");
  await pw.nth(n - 1).fill("password123");
  await tap(page.getByText("Create Account").last(), "create account");
  await page.waitForTimeout(8000);
  check("parent registered", !page.url().includes("/register"), page.url());

  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -f - < "${new URL("./fixtures-phase4-billing.sql", import.meta.url).pathname}"`,
    { stdio: "pipe", shell: "/bin/bash" }
  );

  // ── Home: credit is the TOTAL the family holds across businesses ─────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  let body = await page.evaluate(() => document.body.innerText);
  check("home shows the summed credit balance", body.includes("15.00"), "");

  // ── Billing: each invoice says WHICH business it is from ─────────────────
  await tap(page.getByText("Billing").last(), "billing tab");
  await page.waitForTimeout(6000);
  body = await page.evaluate(() => document.body.innerText);

  check(
    "both businesses' invoices are listed for the same month",
    body.includes("Coach Marcus Swim School") && body.includes("Harbour Swim Club"),
    ""
  );
  check("both amounts present", body.includes("50.00") && body.includes("80.00"));

  // ── PayNow: the payee is the BUSINESS that billed, not the coach ─────────
  // Open the Harbour invoice specifically; if the QR were resolved from the
  // coach, this would show the seed business's payee instead.
  await tap(page.getByText("Harbour Swim Club").last(), "harbour invoice");
  await page.waitForTimeout(6000);
  body = await page.evaluate(() => document.body.innerText);
  const onInvoice = body.includes("Harbour Swim Club");
  check("invoice detail opens for the right business", onInvoice, "");

  const payNow = page.getByText(/PayNow/i);
  if (await payNow.count()) {
    await tap(payNow.last(), "paynow");
    await page.waitForTimeout(6000);
    body = await page.evaluate(() => document.body.innerText);
    check(
      "PayNow names the BILLING business, not the coach",
      body.includes("Harbour Swim Club") && !body.includes("Coach Marcus"),
      ""
    );
  } else {
    check("PayNow button present on the invoice", false, "not found");
  }
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
