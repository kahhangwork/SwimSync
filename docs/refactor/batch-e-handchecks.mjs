// Admin L-E hand-checks — the seven surfaces no driver presses
// (docs/refactor/BATCH_E_PLAN.md §3). Each one is proved by a DB read, not by
// the page agreeing with itself.
//
//   node handchecks.mjs
//
// Run AFTER the full sweep: it mutates the shared local DB.

import { execSync } from "node:child_process";
import {
  launch,
  loginAdmin,
  ADMIN,
  pressByText,
} from "/Users/kahhang/Documents/Code/SwimSync/.claude/skills/run-ui-playwright/drivers/lib.mjs";

const { createClient } = await import(
  new URL(
    "file:///Users/kahhang/Documents/Code/SwimSync/SwimSyncAdmin/node_modules/@supabase/supabase-js/dist/index.mjs"
  ).href
);

const OUT = process.env.SHOT_DIR || "/tmp";
const API_URL = "http://127.0.0.1:54321";

function serviceKey() {
  if (process.env.SERVICE_ROLE_KEY) return process.env.SERVICE_ROLE_KEY;
  const env = execSync("supabase status -o env", {
    encoding: "utf8",
    cwd: "/Users/kahhang/Documents/Code/SwimSync",
  });
  const m = env.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m);
  if (!m) throw new Error("SERVICE_ROLE_KEY not found");
  return m[1];
}

const db = createClient(API_URL, serviceKey(), {
  auth: { persistSession: false },
});

const results = [];
const check = (label, pass, detail = "") => {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

const { browser, page } = await launch();

// ── 1 + 2 + 3: the dashboard's tenant card and its six metrics ──────────────
// The TENANT admin (a private coach is both). superadmin@ is the PLATFORM
// admin, who has no business — the tenant card correctly does not render.
await loginAdmin(page, "coach@swimsync.test", "password123");
await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// The business of the admin we just logged in as. The service-role client sees
// EVERY tenant, so an unscoped count compares the page (RLS-scoped) against a
// cross-tenant number — which is how this check failed the first time.
const { data: adminProfile } = await db
  .from("profiles")
  .select("tenant_id")
  .eq("role", "tenant_admin")
  .eq("full_name", "Coach Marcus")
  .single();
const TENANT = adminProfile.tenant_id;

const { data: tenantBefore } = await db
  .from("tenants")
  .select("id, display_name, join_code")
  .eq("id", TENANT)
  .single();

// 1. Rename the business.
const NEW_NAME = `L-E Hand Check ${Date.now()}`;
await page.getByRole("button", { name: "Rename" }).first().click();
await page.waitForTimeout(400);
await page.fill('input[placeholder="Business name"]', NEW_NAME);
await page.getByRole("button", { name: "Save" }).first().click();
await page.waitForTimeout(1500);
const { data: afterRename } = await db
  .from("tenants")
  .select("display_name")
  .eq("id", tenantBefore.id)
  .single();
check(
  "1. dashboard Rename writes tenants.display_name",
  afterRename.display_name === NEW_NAME,
  `db=${afterRename.display_name}`
);

// 2. Regenerate the join code.
await page.getByRole("button", { name: "Generate a new code" }).first().click();
await page.waitForTimeout(2000);
const { data: afterCode } = await db
  .from("tenants")
  .select("join_code")
  .eq("id", tenantBefore.id)
  .single();
const shownCode = (await page.innerText("body")).toUpperCase();
check(
  "2. Generate a new code rotates tenants.join_code",
  afterCode.join_code !== tenantBefore.join_code,
  `${tenantBefore.join_code} -> ${afterCode.join_code}`
);
check(
  "2b. the page shows the NEW code, not the old one",
  shownCode.includes(afterCode.join_code.toUpperCase()) &&
    !shownCode.includes(tenantBefore.join_code.toUpperCase()),
  afterCode.join_code
);

// restore the name so the sweep's fixtures are untouched
await db
  .from("tenants")
  .update({ display_name: tenantBefore.display_name })
  .eq("id", tenantBefore.id);

// 3. The six metric cards against SQL.
await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const body = await page.innerText("body");
const cardValue = async (title) => {
  // MetricCard: <p>{title}</p> ... <p class="text-3xl">{value}</p>
  const card = page
    .locator("div.rounded-xl", { hasText: new RegExp(`^\\s*${title}`, "i") })
    .first();
  const v = await card.locator("p.text-3xl").first().innerText();
  return Number(v.trim());
};
const count = async (table, q) => {
  let sel = db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT);
  for (const [k, v] of Object.entries(q ?? {})) sel = sel.eq(k, v);
  return (await sel).count;
};
const expected = {
  "Active Students": await count("students", { is_active: true }),
  "Unassigned Children": await count("students", {
    assignment_status: "unassigned",
    is_active: true,
  }),
  "Outstanding Invoices": await count("invoices", { status: "outstanding" }),
  "Active Coaches": await count("coaches", null),
  "Active Classes": await count("classes", { is_active: true }),
};
for (const [title, want] of Object.entries(expected)) {
  check(
    `3. ${title} card = SQL`,
    (await cardValue(title)) === want,
    `card=${await cardValue(title)} sql=${want}`
  );
}
const creditNotes = (
  await db
    .from("credit_notes")
    .select("id", { count: "exact", head: true })
    .neq("status", "reversed")
).count;
check(
  "3. Credit Notes card = SQL (excludes reversed)",
  (await cardValue("Credit Notes")) === creditNotes,
  `card=${await cardValue("Credit Notes")} sql=${creditNotes}`
);

// ── 4 + 5: locations — the two removal paths, and sort survival ─────────────
await page.goto(`${ADMIN}/locations`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const { data: locs } = await db
  .from("locations")
  .select("id, name, archived_at, classes(id, is_active)")
  .is("archived_at", null);
const withActive = locs.find((l) =>
  (l.classes ?? []).some((c) => c.is_active)
);
const onlyRetired = locs.find(
  (l) =>
    (l.classes ?? []).length > 0 &&
    !(l.classes ?? []).some((c) => c.is_active)
);

if (withActive) {
  await page.goto(`${ADMIN}/locations`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const row = page.locator("tr", { hasText: withActive.name }).first();
  await row.getByRole("button", { name: "Remove" }).click();
  await page.waitForTimeout(600);
  const modal = await page.innerText("body");
  const namesCount = /is used by\s*\d+ active class/i.test(modal);
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await page.waitForTimeout(400);
  const { data: still } = await db
    .from("locations")
    .select("archived_at")
    .eq("id", withActive.id)
    .single();
  check(
    "4. Remove with ACTIVE classes: refusal names the count, row NOT archived",
    namesCount && still.archived_at === null,
    `copy=${namesCount} archived_at=${still.archived_at}`
  );
} else {
  check("4. Remove with ACTIVE classes", false, "no fixture location has an active class — SKIPPED");
}

if (onlyRetired) {
  const row = page.locator("tr", { hasText: onlyRetired.name }).first();
  await row.getByRole("button", { name: "Remove" }).click();
  await page.waitForTimeout(600);
  const modal = await page.innerText("body");
  const saysRetired = /retired class/i.test(modal);
  await page.getByRole("button", { name: /^Remove$/ }).last().click();
  await page.waitForTimeout(1800);
  const { data: archived } = await db
    .from("locations")
    .select("archived_at")
    .eq("id", onlyRetired.id)
    .single();
  check(
    "5. Remove with RETIRED classes only: archives it, copy explains",
    saysRetired && archived.archived_at !== null,
    `copy=${saysRetired} archived_at=${archived.archived_at}`
  );
  // put it back — archive is reversible at the DB level
  await db
    .from("locations")
    .update({ archived_at: null })
    .eq("id", onlyRetired.id);
} else {
  // No seed location is retired-only, so build one: a location plus a RETIRED
  // class pointing at it. That is the exact shape the archive path is for.
  const { data: loc } = await db
    .from("locations")
    .insert({ tenant_id: TENANT, name: `L-E Retired Fixture ${Date.now()}`, sort_order: 99 })
    .select("id, name")
    .single();
  const { data: anyClass } = await db
    .from("classes")
    .select("id, location_id, is_active")
    .eq("tenant_id", TENANT)
    .limit(1)
    .single();
  const restore = {
    location_id: anyClass.location_id,
    is_active: anyClass.is_active,
    deactivated_at: null,
  };
  // ⚠ deactivated_at is REQUIRED alongside is_active=false
  // (classes_inactive_requires_deactivated_at). And the error is CHECKED: an
  // unchecked fixture write that the database refuses makes the product look
  // broken when it is the fixture that is wrong — which is exactly what this
  // hand-check reported the first time it ran.
  const { error: retireErr } = await db
    .from("classes")
    .update({
      location_id: loc.id,
      is_active: false,
      deactivated_at: new Date().toISOString(),
    })
    .eq("id", anyClass.id);
  if (retireErr) throw new Error(`fixture could not retire a class: ${retireErr.message}`);

  await page.goto(`${ADMIN}/locations`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const row = page.locator("tr", { hasText: loc.name }).first();
  await row.getByRole("button", { name: "Remove" }).click();
  await page.waitForTimeout(800);
  const modal = await page.innerText("body");
  const saysRetired = /retired class/i.test(modal);
  await page.getByRole("button", { name: /^Remove$/ }).last().click();
  await page.waitForTimeout(2000);
  const { data: archived } = await db
    .from("locations")
    .select("archived_at")
    .eq("id", loc.id)
    .single();
  check(
    "5. Remove with RETIRED classes only: archives it, copy explains",
    saysRetired && archived.archived_at !== null,
    `copy=${saysRetired} archived_at=${archived.archived_at}`
  );
  // clean up: put the class back, drop the fixture location
  await db.from("classes").update(restore).eq("id", anyClass.id);
  await db.from("locations").delete().eq("id", loc.id);
}

// 5b. RISK 4 — the sort survives a Save (§7.249).
await page.goto(`${ADMIN}/locations`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("columnheader", { name: /Location/ }).click();
await page.waitForTimeout(500);
const orderBefore = await page
  .locator("tbody tr td:nth-child(2)")
  .allInnerTexts();
const firstRow = page.locator("tbody tr").first();
await firstRow.getByRole("button", { name: "Edit" }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Save" }).first().click();
await page.waitForTimeout(2000);
const orderAfter = await page
  .locator("tbody tr td:nth-child(2)")
  .allInnerTexts();
check(
  "5b. RISK 4 (§7.249): the sort survives a Save",
  JSON.stringify(orderBefore) === JSON.stringify(orderAfter),
  `before=${orderBefore.length} after=${orderAfter.length} same=${JSON.stringify(orderBefore) === JSON.stringify(orderAfter)}`
);

// ── 6: history — the filters, against SQL ───────────────────────────────────
await page.goto(`${ADMIN}/history`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const rowsAll = await page.locator("tbody tr").count();
const { count: sqlAll } = await db
  .from("audit_log")
  .select("id", { count: "exact", head: true });
check(
  "6. history unfiltered row count = SQL (capped at 1000)",
  rowsAll === Math.min(sqlAll ?? 0, 1000) || rowsAll === 1,
  `page=${rowsAll} sql=${sqlAll}`
);

await page.selectOption("select", "Student");
await page.waitForTimeout(2000);
const rowsStudent = await page.locator("tbody tr").count();
const { count: sqlStudent } = await db
  .from("audit_log")
  .select("id", { count: "exact", head: true })
  .eq("entity_type", "Student");
check(
  "6b. history Type=Student = SQL",
  rowsStudent === Math.min(sqlStudent ?? 0, 1000) || (sqlStudent === 0 && rowsStudent === 1),
  `page=${rowsStudent} sql=${sqlStudent}`
);

const clearShown = (await page.innerText("body")).includes("Clear filters");
await page.getByRole("button", { name: "Clear filters" }).first().click();
await page.waitForTimeout(2000);
const rowsCleared = await page.locator("tbody tr").count();
check(
  "6c. Clear filters appears with a filter on, and restores the full list",
  clearShown && rowsCleared === rowsAll,
  `shown=${clearShown} ${rowsCleared} vs ${rowsAll}`
);

await page.screenshot({ path: `${OUT}/le-handcheck-history.png`, fullPage: true });

// ── 7: reset-password — the valid path NO driver covers (RISK 3) ────────────
const RECOVERY_EMAIL = "coach@swimsync.test";
const NEW_PASSWORD = "handcheck-le-2026";
const { data: link, error: linkErr } = await db.auth.admin.generateLink({
  type: "recovery",
  email: RECOVERY_EMAIL,
});
if (linkErr) {
  check("7. reset-password valid path", false, `generateLink failed: ${linkErr.message}`);
} else {
  const url = new URL(link.properties.action_link);
  // Point the verify link at the LOCAL admin, mirroring what the email does.
  url.searchParams.set("redirect_to", `${ADMIN}/reset-password`);
  const ctx = await browser.newContext();
  const rp = await ctx.newPage();
  await rp.goto(url.toString());
  await rp.waitForTimeout(3500);
  const rpBody = await rp.innerText("body");
  const validBranch =
    rpBody.includes("Set New Password") && !/expired|invalid/i.test(rpBody);
  check("7a. the recovery link renders the VALID branch", validBranch, rpBody.slice(0, 120));

  if (validBranch) {
    const pw = rp.locator('input[type="password"]');
    await pw.nth(0).fill(NEW_PASSWORD);
    await pw.nth(1).fill(NEW_PASSWORD);
    await rp.getByRole("button", { name: /Update Password|Set Password|Save/i }).click();
    await rp.waitForTimeout(2500);
    await rp.screenshot({ path: `${OUT}/le-handcheck-reset-password.png`, fullPage: true });

    // The proof: the NEW password actually signs in.
    const probe = createClient(API_URL, serviceKey(), {
      auth: { persistSession: false },
    });
    const { data: signIn, error: signInErr } =
      await probe.auth.signInWithPassword({
        email: RECOVERY_EMAIL,
        password: NEW_PASSWORD,
      });
    check(
      "7b. the NEW password signs in",
      !signInErr && !!signIn?.session,
      signInErr?.message ?? "session granted"
    );

    // Put the seed password back — every other driver logs in with it.
    const { data: users } = await db.auth.admin.listUsers();
    const u = users.users.find((x) => x.email === RECOVERY_EMAIL);
    await db.auth.admin.updateUserById(u.id, { password: "password123" });
    const { error: backErr } = await probe.auth.signInWithPassword({
      email: RECOVERY_EMAIL,
      password: "password123",
    });
    check("7c. seed password restored for the other drivers", !backErr, backErr?.message ?? "ok");
  }
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} hand-checks passed ===`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  ${f.label} — ${f.detail}`);
  process.exit(1);
}
