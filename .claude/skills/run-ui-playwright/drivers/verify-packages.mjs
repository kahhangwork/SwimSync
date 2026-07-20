// Drives prepaid packages end-to-end across both UIs (PACKAGES_DESIGN.md §8).
//
// pgTAP owns the money rules and the Deno suite owns the engine; this exists
// for what only the real UI can prove:
//   • the LIVE balance (RPC) actually reaches the parent's card and the
//     admin's tables — 9 lessons, not the stored 10 (§7.28 territory:
//     a wrong nesting level typechecks and renders the wrong number);
//   • the request → PayNow → pending → admin-confirm loop round-trips;
//   • the students-page "running low" filter obeys its per-tenant threshold
//     in both directions.
//
// Prereqs: supabase db reset, fixtures applied, admin dev server + Expo web:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-packages.sql
//   node drivers/verify-packages.mjs
import { launch, loginAdmin, loginExpo, tap, ADMIN, EXPO } from "./lib.mjs";

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

const { browser, page } = await launch({ headless: true });

try {
  // ── Parent: the live card, and a request ──────────────────────────────────
  console.log("\n[parent] live balance card + request flow");
  await loginExpo(page, "parent-pkg@swimsync.test");

  // In-app navigation, not a deep link — a protected route can bounce to
  // /login while the store rehydrates (lib.mjs gotcha).
  await tap(page.getByText("Billing", { exact: true }).last(), "Billing tab");
  await page.waitForTimeout(3000);
  await tap(page.getByText("Packages", { exact: true }), "Packages tab");
  await page.waitForTimeout(2500);

  let text = await page.evaluate(() => document.body.innerText);
  check(/10 Group Lessons/.test(text), "the held package renders");
  // Assert on strings unique to this card (§7.10 — the stack keeps previous
  // screens mounted, so generic strings can pass against the wrong screen).
  check(/9\s*\n?\s*lessons remaining/.test(text),
    "the card shows the LIVE count (9) — the un-invoiced lesson is subtracted",
    text.slice(0, 400));
  check(/S\$225\.00 of S\$250\.00/.test(text),
    "…and the live value against the total");
  check(/5 Lesson Starter/.test(text), "the second product is offered");

  // .last(): products list alphabetically ("10 Group Lessons" before
  // "5 Lesson Starter"), and the first run of this driver bought the wrong
  // product by tapping .first() — the paynow assertions then read $250.
  await tap(page.getByText("Request & pay").last(), "Request & pay (5 Lesson Starter)");
  await page.waitForTimeout(5000);
  text = await page.evaluate(() => document.body.innerText);
  check(/S\$150\.00/.test(text),
    "the PayNow screen asks for the PACKAGE price (5 × $30)");
  check(/5 Lesson Starter/.test(text), "…and names the package");

  await page.goBack();
  await page.waitForTimeout(3000);
  text = await page.evaluate(() => document.body.innerText);
  check(/Pending/.test(text) && /Waiting for .* to confirm/.test(text),
    "back on Billing, the request shows as pending confirmation");

  // ── Admin: confirm the request ────────────────────────────────────────────
  console.log("\n[admin] pending queue → confirm");
  await loginAdmin(page, "coach@swimsync.test");
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  text = await page.evaluate(() => document.body.innerText);
  check(/Awaiting confirmation \(1\)/.test(text), "the request sits in the queue");
  check(/Paula Package/.test(text), "…named to the right parent");
  check(/9 lessons/.test(text),
    "the held table shows the LIVE remaining (9) for the older package");

  await tap(page.getByRole("button", { name: "Payment received" }).first(),
    "Payment received (row)");
  await page.waitForTimeout(800);
  await tap(page.getByRole("button", { name: "Payment received" }).last(),
    "Payment received (modal)");
  await page.waitForTimeout(2500);

  text = await page.evaluate(() => document.body.innerText);
  check(!/Awaiting confirmation/.test(text), "the queue is empty after confirming");
  // NOT /5 Lesson Starter/ alone — the PRODUCTS table on the same page also
  // contains that string, so it would pass with no held row at all (§7.10's
  // whole-page-innerText trap). "5 lessons · S$150.00" only renders on a
  // held, active package's live-balance cell.
  check(/5 lessons · S\$150\.00/.test(text),
    "the new package is held, Active, with its live balance");

  // Idempotence note: the WHERE status='pending' guard is pinned in pgTAP;
  // here we only prove the UI path lands.

  // ── Admin: the per-tenant "running low" filter ────────────────────────────
  console.log("\n[admin] students low-balance filter, both directions");
  await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await tap(page.getByRole("button", { name: "Package running low" }), "filter on");
  await page.waitForTimeout(800);

  const threshold = page.getByLabel("Low-package threshold in lessons");
  // Family live total = 9 + 5 = 14 lessons. At 20 they are "low"…
  await threshold.fill("20");
  await page.waitForTimeout(1200);
  text = await page.evaluate(() => document.body.innerText);
  check(/Pablo Package/.test(text), "at threshold 20 the family is flagged");
  check(/14 left/.test(text), "…with the family's combined live count");

  // …and at 2 they are not (and no package-less family ever appears).
  await threshold.fill("2");
  await page.waitForTimeout(1200);
  text = await page.evaluate(() => document.body.innerText);
  check(!/Pablo Package/.test(text) && /No students found/.test(text),
    "at threshold 2 nobody is flagged");

  // ── Admin: invoices table carries the package column ─────────────────────
  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  text = await page.evaluate(() => document.body.innerText);
  check(/Package/.test(text), "the invoices table has a Package column");
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
