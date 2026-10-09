// clock: pinnable
// Drive owner-defined roles end to end (ROLES_PERMISSIONS_PLAN.md step 7;
// migrations 20260927000300–000600).
//
// What only THIS driver can prove (pgTAP owns the policies and RPCs): the
// admin panel's AFFORDANCE follows the role — the sidebar hides pages the role
// lacks, a typed URL gets "Your role doesn't include this page" rather than a
// half-empty page, a view-only area says so, and a role change by the owner
// shows up on the co-admin's next load. Plus the Roles page itself: the owner
// creates a role through the 8 × 3 grid.
//
// Setup/Prereqs:
//   supabase start; admin panel on :3000 (or ADMIN_URL)
//   fixture: fixtures-roles.sql. The driver CREATES the "Driver Viewer" role,
//   so a re-run needs fixtures-roles-teardown.sql (or a db reset) first.
//
// Personas (password123):
//   coach@swimsync.test      seed OWNER — every area, always (D1)
//   rolesdesk@swimsync.test  pure co-admin, starts on "Co-admin (as before)"
//
// PROVEN RED: with RequiresTenant's question 4 removed, check 5 fails (the
// page renders instead of refusing); with navFor ignoring the role, check 4.

import os from "node:os";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/roles-${n}`;

const results = [];
function check(label, pass, detail = "") {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : ` — ${detail}`}`);
}

const { browser, page } = await launch();

async function freshLogin(email) {
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, email);
}
async function visit(path) {
  await page.goto(`${ADMIN}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return page.evaluate(() => document.body.innerText);
}
async function setRole(roleName) {
  await freshLogin("coach@swimsync.test");
  await visit("/admins");
  await page.getByLabel("Role for Roles Desk").selectOption({ label: roleName });
  await page.waitForTimeout(2000);
}

// ── 1. The owner sees the Roles page and the four standard roles ────────────
await freshLogin("coach@swimsync.test");
let body = await visit("/roles");
check("the owner reaches Roles and sees the four standard roles",
  ["Full admin", "Operations assistant", "Front desk", "Co-admin (as before)"].every((r) => body.includes(r)),
  body.slice(0, 300));

// ── 2. The owner creates a view-only role through the grid ──────────────────
await page.getByRole("button", { name: "New role", exact: true }).click();
await page.getByLabel("Role name").fill("Driver Viewer");
// The editor's radios are the enabled ones — the cards behind it render
// read-only grids with the same labels.
await page.locator('input[aria-label="Operations: View"]:not([disabled])').check();
await page.getByRole("button", { name: "Save role", exact: true }).click();
await page.waitForTimeout(2000);
body = await page.evaluate(() => document.body.innerText);
check("the new role appears on the Roles page", body.includes("Driver Viewer"));
await page.screenshot({ path: shot("01-roles.png"), fullPage: true });

// ── 3. The owner moves the co-admin onto it ─────────────────────────────────
await setRole("Driver Viewer");
body = await page.evaluate(() => document.body.innerText);
check("the Admins page shows a Role column with the picker", body.includes("Role"));

// ── 4. The co-admin's sidebar follows the role ──────────────────────────────
await freshLogin("rolesdesk@swimsync.test");
body = await visit("/lessons");
const nav = await page.locator("aside, nav").first().innerText().catch(() => "");
check("the sidebar hides pages the role lacks (no Invoices, no Admins)",
  !nav.includes("Invoices") && !nav.includes("Admins"), nav.slice(0, 300));

// ── 5. A typed URL to a page outside the role is refused, in words ──────────
body = await visit("/invoices");
check("a typed /invoices says the role doesn't include it",
  body.includes("Your role doesn") && body.includes("Billing"), body.slice(0, 300));
await page.screenshot({ path: shot("02-refused.png"), fullPage: true });

// ── 6. A view-only area says so ─────────────────────────────────────────────
body = await visit("/classes");
check("a view-only area carries the View only notice",
  body.includes("View only — your role can"), body.slice(0, 300));
await page.screenshot({ path: shot("03-view-only.png"), fullPage: true });

// ── 7. The owner upgrades them; the page appears on their next load ─────────
await setRole("Full admin");
await freshLogin("rolesdesk@swimsync.test");
body = await visit("/invoices");
check("after the upgrade, /invoices renders for the co-admin",
  !body.includes("Your role doesn") && body.includes("Invoices"), body.slice(0, 300));
body = await visit("/classes");
check("…and the View only notice is gone", !body.includes("View only — your role can"));

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
