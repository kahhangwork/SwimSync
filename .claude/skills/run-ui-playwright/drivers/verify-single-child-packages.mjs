// clock: pinnable
//
// SINGLE-CHILD PACKAGES — docs/plans/SINGLE_CHILD_PACKAGES_PLAN.md (20261010000100).
// Fixture: fixtures-single-child-packages.sql (prefix scp / ids a5c00000-).
//
// What it proves, end to end in both apps:
//   • ⚠ RISK 11 — the PRECONDITIONS first, as their own checks: Ava's package is active and covers the T−8
//     lesson; Ben's T−8 lesson is inside that window. Only then: Ava's draw came from her package and Ben's
//     did not (D3) — a "Ben is ad-hoc" check is meaningless unless the package COULD have paid.
//   • Parent app: Ava's chip "Package · 4 left", Ben's "Ad-hoc"; Ava's profile says the package is hers;
//     the card says "For Ava Scp only"; a SHARED request is refused inline with the database's sentence
//     (D11 — one kind per family); "Which child is this for?" → Ben → the pending row is tied to Ben.
//   • Admin: the catalogue's "Who can use it"; "Ava Scp only" / "Ben Scp only" labels; Change child on a
//     USED package shows the RPC's refusal inline (RISK 10); a one-child sale to a one-child family is shown,
//     not asked (D7) and is tied to Cai; flipping a product's kind is confirmed "Applies to new sales only".
//
// Setup:
//   cd SwimSyncAdmin && npm run dev            # :3000
//   cd SwimSyncApp && npx expo start --web     # :8081
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-single-child-packages.sql
//   node .claude/skills/run-ui-playwright/drivers/verify-single-child-packages.mjs

import os from "node:os";
import { launch, loginExpo, loginAdmin, tap, ADMIN, todaySg, addDaysIso, sql } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const AVA = "a5c00000-0000-0000-0000-0000000005a0";
const BEN = "a5c00000-0000-0000-0000-0000000005b0";
const CAI = "a5c00000-0000-0000-0000-0000000005c0";
const AVA_PKG = "a5c00000-0000-0000-0000-00000000e0a0";
const TENANT = "a5c00000-0000-0000-0000-000000000001";

const results = [];
function check(label, cond, detail = "") {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail && !cond ? ` — ${detail}` : ""}`);
}
const text = (page) => page.evaluate(() => document.body.innerText);

const today = todaySg();
const t8 = addDaysIso(today, -8);

const { browser, page } = await launch({ mobile: true });

try {
  // ── RISK 11: preconditions, each its own check ─────────────────────────────────────────────────────────────
  const pkg = sql(`SELECT status || '|' || start_date || '|' || expires_on || '|' || value_remaining
                     FROM parent_packages WHERE id = '${AVA_PKG}'`).split("|");
  check("precondition: Ava's own package is active", pkg[0] === "active", pkg.join("|"));
  check("precondition: its window covers the T−8 lesson (so it COULD pay Ben's too)",
    pkg[1] <= t8 && t8 <= pkg[2], `${pkg[1]}..${pkg[2]} vs ${t8}`);
  const benInWindow = sql(`SELECT count(*) FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
                             WHERE a.student_id = '${BEN}' AND a.status = 'present' AND ls.session_date = '${t8}'`);
  check("precondition: Ben's present lesson on T−8 exists, inside the window", benInWindow === "1");
  const drawn = sql(`SELECT string_agg(student_id::text, ',') FROM package_applications
                      WHERE parent_package_id = '${AVA_PKG}' AND reversed_at IS NULL`);
  check("Ava's lesson drew from her package, Ben's did not (D3)", drawn === AVA, drawn);

  // ── Parent app ─────────────────────────────────────────────────────────────────────────────────────────────
  await loginExpo(page, "scp-parent@swimsync.test");
  await page.waitForTimeout(2500);
  let t = await text(page);
  check("home: Ava wears 'Package · 4 left'", /Ava Scp\s*\n\s*Package · 4 left/.test(t), t.slice(0, 500));
  check("home: Ben wears 'Ad-hoc' — his sister's package is not his", /Ben Scp\s*\n\s*Ad-hoc/.test(t));

  await tap(page.getByText("Ava Scp", { exact: true }).first(), "Ava's card");
  await page.waitForTimeout(2500);
  t = await text(page);
  check("Ava's profile: the package is hers, not 'shared across the family'",
    /Package — 4 lessons left · Ava's own/.test(t), t.slice(0, 600));
  await page.goBack();
  await page.waitForTimeout(2000);

  await tap(page.getByText("Billing", { exact: true }).last(), "Billing tab");
  await page.waitForTimeout(3000);
  await tap(page.getByText("Packages", { exact: true }), "Packages tab");
  await page.waitForTimeout(2500);
  t = await text(page);
  check("the held card says whose it is: 'For Ava Scp only'", /For Ava Scp only/.test(t));
  check("a one-child product asks 'Which child is this for?' (two children here)", /Which child is this for\?/.test(t));

  // Products list alphabetically: SCP One Child, then SCP Shared (.last()).
  await tap(page.getByText("Request & pay").last(), "Request & pay (SCP Shared)");
  await page.waitForTimeout(2500);
  t = await text(page);
  check("a SHARED request is refused inline with the database's sentence (D11)",
    /This family has a one-child package that is pending or has lessons left — a shared package can be bought once it is used up\./.test(t));

  await tap(page.getByText("Ben Scp", { exact: true }).last(), "Ben (picker)");
  await tap(page.getByText("Request & pay").first(), "Request & pay (SCP One Child)");
  await page.waitForTimeout(5000);
  const req = sql(`SELECT status || '|' || COALESCE(student_id::text, 'shared') FROM parent_packages
                    WHERE tenant_id = '${TENANT}' AND id <> '${AVA_PKG}' AND student_id = '${BEN}'`);
  check("the request is a pending package tied to Ben", req === `pending|${BEN}`, req);
  await page.screenshot({ path: `${SHOT}/scp-parent.png`, fullPage: true });

  // ── Admin ──────────────────────────────────────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAdmin(page, "scp-owner@swimsync.test");
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  t = await text(page);
  check("catalogue: 'Who can use it' shows both kinds",
    /Who can use it/i.test(t) && /One child only/.test(t) && /Shared across siblings/.test(t));
  check("held: 'Ava Scp only'; pending: 'Ben Scp only'", /Ava Scp only/.test(t) && /Ben Scp only/.test(t));

  // Change child on Ava's USED package → the RPC's refusal, inline (RISK 10).
  const avaRow = page.locator("tr", { hasText: "Ava Scp only" });
  await tap(avaRow.getByRole("button", { name: "Change child", exact: true }), "Change child (Ava)");
  const modal = page.locator("div.fixed.inset-0");
  await modal.locator("select").selectOption({ label: "Ben Scp" });
  await tap(modal.getByRole("button", { name: "Change child", exact: true }), "confirm Change child");
  await page.waitForTimeout(1500);
  check("Change child on a used package shows the refusal inline",
    /A lesson has already drawn from this package — refund it instead\./.test(await modal.innerText().catch(() => "")));
  check("…and nothing moved", sql(`SELECT student_id FROM parent_packages WHERE id = '${AVA_PKG}'`) === AVA);
  await tap(modal.getByRole("button", { name: "Cancel", exact: true }), "close Change child");

  // Record a sale: SCP Solo + SCP One Child → shown, not asked (D7).
  await tap(page.getByRole("button", { name: "Record a sale", exact: true }), "Record a sale");
  await modal.locator("select").first().selectOption({ label: "SCP Solo Parent" });
  await modal.locator("select").nth(1).selectOption({ label: "SCP One Child — S$150.00 (one child)" });
  await page.waitForTimeout(1500);
  check("one child at this business: 'For Cai Scp', not a question",
    /For Cai Scp/.test(await modal.innerText()) && !/Which child is this for\?/.test(await modal.innerText()));
  await tap(modal.getByRole("button", { name: "Record sale", exact: true }), "Record sale");
  await page.waitForTimeout(3000);
  const sale = sql(`SELECT status || '|' || student_id FROM parent_packages WHERE tenant_id = '${TENANT}' AND student_id = '${CAI}'`);
  check("the sale is an active package tied to Cai", sale === `active|${CAI}`, sale);
  // A backdated sale may ask the D5 question; dismiss it if it did.
  const keep = page.getByRole("button", { name: "Keep as ad-hoc" });
  if (await keep.count()) await tap(keep, "Keep as ad-hoc");

  // Flip a product's kind (D6) — confirmed, new sales only.
  const sharedRow = page.locator("tr", { hasText: "SCP Shared" });
  await tap(sharedRow.getByRole("button", { name: "Change", exact: true }), "Change kind (SCP Shared)");
  check("the flip says it applies to new sales only",
    /Applies to new sales only — packages already sold keep their terms\./.test(await modal.innerText()));
  await tap(modal.getByRole("button", { name: "Change", exact: true }), "confirm flip");
  await page.waitForTimeout(2000);
  check("SCP Shared is now one child only",
    sql(`SELECT single_child FROM package_products WHERE id = 'a5c00000-0000-0000-0000-00000000d0b0'`) === "t");
  await page.screenshot({ path: `${SHOT}/scp-admin.png`, fullPage: true });
} catch (e) {
  // §7.79 — a crash is a failed check, so it goes through the same tally.
  check(`the driver ran to completion — it crashed: ${e.message}`, false, String(e.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(results.length > 0 && passed === results.length ? 0 : 1);
}
