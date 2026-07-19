// Drives the platform-admin surfaces: the cross-tenant business list and the
// student rescue tool (moving a child who joined with the wrong code).
//
// Also checks the NEGATIVE case, which is the one that matters: a TENANT admin
// must not see the Platform nav item, and must be refused if they reach the URL
// directly. The page's own gate is a UX affordance — the real boundary is
// reassign_student_tenant(), which is platform-admin-only in the database.
//
// Prereqs: supabase start · db reset · admin on :3000.
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// A second tenant + a student to move, seeded through the service role so the
// UI has something cross-tenant to act on.
const { createClient } = await import(
  "/Users/kahhang/Documents/Code/SwimSync/SwimSyncAdmin/node_modules/@supabase/supabase-js/dist/index.mjs"
);
const svc = createClient(
  "http://127.0.0.1:54321",
  process.env.SERVICE_ROLE_KEY
);

// UNIQUE display name per run. A stale tenant from an earlier run would
// otherwise share the label, and selectOption({ label }) picks the FIRST match
// — which silently moved the child into the wrong (old) tenant and made the
// database assertion fail while the UI reported success.
const RESCUE_NAME = `Rescue Swim Academy ${String(Date.now()).slice(-5)}`;

const { data: t2 } = await svc
  .from("tenants")
  .insert({
    slug: `rescue-${Date.now()}`,
    display_name: RESCUE_NAME,
    join_code: `SWIM-RS${String(Date.now()).slice(-2)}`,
  })
  .select("id")
  .single();

const { data: seedTenant } = await svc
  .from("tenants")
  .select("id")
  .eq("slug", "marcus-swim")
  .single();

const { data: kid } = await svc
  .from("students")
  .insert({
    full_name: "Wrongcode Kid",
    assignment_status: "unassigned",
    tenant_id: seedTenant.id,
  })
  .select("id")
  .single();

const { browser, page } = await launch({ headless: true });

try {
  // ── A TENANT admin must not get the platform surface ──────────────────────
  await loginAdmin(page, "coach@swimsync.test", "password123");
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  let body = await page.evaluate(() => document.body.innerText);
  check("tenant admin does NOT see the Platform nav item", !body.includes("Platform"));

  await page.goto(`${ADMIN}/platform`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  body = await page.evaluate(() => document.body.innerText);
  check(
    "tenant admin reaching /platform directly is refused",
    body.includes("for the SwimSync platform admin")
  );

  // ── The PLATFORM admin gets it ────────────────────────────────────────────
  await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, "superadmin@swimsync.test", "password123");
  await page.goto(`${ADMIN}/platform`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  body = await page.evaluate(() => document.body.innerText);

  check("platform admin sees both businesses",
    body.includes("Coach Marcus Swim School") && body.includes(RESCUE_NAME));

  // ── The rescue: move the child to the other business ─────────────────────
  await page.getByPlaceholder(/Search a child/).fill("Wrongcode");
  // .first(): the page has TWO "Search" buttons — the student search and the
  // family-status search below it — so a bare getByRole is a strict-mode
  // violation. This driver had been failing on it since family status was
  // added, which nobody noticed because the driver is run by hand.
  await page.getByRole("button", { name: "Search" }).first().click();
  await page.waitForTimeout(1500);
  body = await page.evaluate(() => document.body.innerText);
  check("student search finds the child", body.includes("Wrongcode Kid"));

  await page.selectOption("select", { label: RESCUE_NAME });
  await page.waitForTimeout(2500);
  body = await page.evaluate(() => document.body.innerText);
  check("move reports success", body.includes("Moved."), "");

  // The DB is the check that matters, not the toast.
  const { data: after } = await svc
    .from("students")
    .select("tenant_id")
    .eq("id", kid.id)
    .single();
  check(
    "child actually moved to the new business in the database",
    after.tenant_id === t2.id,
    `tenant_id=${after.tenant_id}`
  );
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  await browser.close();
  // Clean up so the suite leaves the DB as it found it.
  // reassign_student_tenant() writes an audit_log row against the NEW tenant,
  // whose FK blocks the tenant delete. Missing this is why a tenant leaked from
  // the previous run in the first place.
  await svc.from("audit_log").delete().eq("tenant_id", t2.id);
  await svc.from("students").delete().eq("id", kid.id);
  const { error: cErr } = await svc.from("tenants").delete().eq("id", t2.id);
  if (cErr) console.log("CLEANUP WARNING:", cErr.message);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
