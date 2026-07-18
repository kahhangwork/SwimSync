// Drives the admin panel after the multi-tenancy role split.
//
// `superadmin` no longer exists — it became `tenant_admin` (one business) and
// `platform_admin` (SwimSync itself). The login page, the invoice generation
// controls and the coverage dialog all changed with it, and none of that is
// covered by unit tests. This drives the real UI.
//
// The seed's coach IS the tenant admin (a private coach = a tenant of one), so
// coach@swimsync.test is the account that administers the business.
//
// Prereqs: supabase start · db reset · SwimSyncAdmin on :3000.
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const { browser, page } = await launch({ headless: true });

try {
  // ── 1. The TENANT admin (the seeded private coach) can sign in ───────────
  // Before the role fix the login page tested `role !== "superadmin"` and
  // rejected every account, so the panel was completely unreachable.
  await loginAdmin(page, "coach@swimsync.test", "password123");
  check(
    "tenant_admin can log into the admin panel",
    !page.url().includes("/login"),
    page.url()
  );

  // ── 2. The invoices page loads and its controls are live ────────────────
  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText);

  check("invoices page renders", body.includes("Invoices"), page.url());

  // The per-tenant billing schedule is read from `tenants` now. If it were
  // still pointed at the removed global app_settings rows, the run-day input
  // would render empty.
  const runDay = await page
    .locator('input[type="number"]')
    .first()
    .inputValue()
    .catch(() => "");
  check(
    "run day loads from the tenant row",
    runDay !== "" && Number(runDay) >= 1 && Number(runDay) <= 28,
    `value=${runDay || "(empty)"}`
  );

  // A tenant admin has a business, so they must NOT see the platform notice.
  check(
    "no platform-admin notice for a tenant admin",
    !body.includes("Invoice generation runs for one business at a time")
  );

  // ── 3. Saving the run day writes to the tenant, not app_settings ─────────
  const input = page.locator('input[type="number"]').first();
  await input.fill("12");
  await input.blur();
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const persisted = await page
    .locator('input[type="number"]')
    .first()
    .inputValue()
    .catch(() => "");
  check(
    "run day persists across reload (written to tenants)",
    persisted === "12",
    `after reload=${persisted}`
  );

  // ── 4. Other admin screens still resolve their joins ────────────────────
  for (const [path, needle] of [
    ["/students", "Students"],
    ["/classes", "Classes"],
    ["/coaches", "Coaches"],
  ]) {
    await page.goto(`${ADMIN}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const t = await page.evaluate(() => document.body.innerText);
    check(
      `${path} renders`,
      t.includes(needle) && !t.toLowerCase().includes("something went wrong"),
      ""
    );
  }

  // ── 5. The PLATFORM admin gets the notice, not a dead button ────────────
  await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, "superadmin@swimsync.test", "password123");
  check(
    "platform_admin can log in",
    !page.url().includes("/login"),
    page.url()
  );

  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const platformBody = await page.evaluate(() => document.body.innerText);
  check(
    "platform_admin sees the 'no business attached' notice",
    platformBody.includes("Invoice generation runs for one business at a time")
  );
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
