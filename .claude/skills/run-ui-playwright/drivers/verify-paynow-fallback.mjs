// Drives the PayNow fallback chain (Wave 1 Chunk 2, plan RISK 3).
//
// WHY THIS DRIVER EXISTS, AND WHY IT IS NOT OPTIONAL. Chunk 2 made the
// computed dynamic QR the primary payment mechanism for BOTH invoices and
// packages, and demoted the uploaded static image to a collapsed disclosure on
// the coach's Settings screen. That screen is the ONLY writer of
// tenants.paynow_qr_url anywhere in the product, and before this file nothing
// in either test suite and none of the other 38 drivers touched
// app/(coach)/settings at all.
//
// The failure being guarded against is a business with NO way to be paid:
//   1. an admin types a PayNow mobile with a typo. normalizeSgPhone only
//      STRIPS NON-DIGITS and checkSgPhone is advisory, so '912345678' (nine
//      digits) saves fine and there is no DB CHECK;
//   2. selectPayNowProxy returns it, so "this business has configured PayNow"
//      is TRUE;
//   3. buildPayNowPayload throws on !/^\d{8}$/ and the screen falls back to
//      the uploaded image — which is NULL.
// If the upload had been HIDDEN on "a proxy exists" (the tempting gate), step
// 3 has nowhere to land and every parent at that business sees a dead end.
// Case B below is that exact state, and it is the check that decides whether
// the risk is real. It is asserted from BOTH sides: the parent must still be
// able to pay by hand, and the coach must still be able to reach the upload.
//
// Prereqs: supabase db reset, fixture applied, admin dev server + Expo web:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-paynow-fallback.sql
//   node drivers/verify-paynow-fallback.mjs
import { execSync } from "node:child_process";
import path from "node:path";
import { launch, loginExpo, tap, EXPO } from "./lib.mjs";

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

const TENANT = "70000000-0000-0000-0000-000000000001";

function sql(statement) {
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tA -c ${JSON.stringify(
      statement
    )}`,
    { encoding: "utf8" }
  ).trim();
}

/** The seed tenant's PayNow configuration is what this driver varies, and it
 *  is a row the driver does not own. Captured up front and restored in the
 *  finally, so a crashed run cannot leave a later driver running against a
 *  business this one configured (§7.101 is the same lesson from the other
 *  direction: shared database, so touch only what you can put back). */
function setPayNow({ uen = null, mobile = null, qrUrl = null }) {
  const lit = (v) => (v === null ? "NULL" : `'${v}'`);
  sql(
    `UPDATE tenants SET paynow_uen = ${lit(uen)}, paynow_mobile = ${lit(mobile)}, ` +
      `paynow_qr_url = ${lit(qrUrl)} WHERE id = '${TENANT}'`
  );
}

const reference = sql(
  `SELECT reference_number FROM parent_packages WHERE id = 'ef000000-0000-0000-0000-0000000000f1'`
);

const { browser, page } = await launch({ headless: true });

/** Log in as a DIFFERENT user. loginExpo short-circuits when the page is
 *  already on the app and off /login — correct for its own retry loop, and
 *  wrong for a driver that changes persona mid-run: it would keep the previous
 *  session and report success. This driver switches three times, so clearing
 *  the persisted session first is not optional. Same shape as
 *  verify-admins.mjs's freshLogin, for the admin panel. */
async function freshLogin(email) {
  await page.goto(`${EXPO}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await loginExpo(page, email);
}

/** Open the parent's PayNow screen for the fixture's pending package. Reached
 *  by IN-APP navigation, not a deep link: a protected route can bounce to
 *  /login while the store rehydrates (lib.mjs), and §7.98 records that the two
 *  need opposite answers. */
async function openPackagePayNow() {
  await page.goto(EXPO, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await tap(page.getByText("Billing", { exact: true }).last(), "Billing tab");
  await page.waitForTimeout(3000);
  await tap(page.getByText("Packages", { exact: true }), "Packages tab");
  await page.waitForTimeout(2500);
  await tap(page.getByText("Pay via PayNow", { exact: true }).first(), "Pay via PayNow");
  await page.waitForTimeout(3500);
  return page.evaluate(() => document.body.innerText);
}

/** How many <img> elements carry a generated data: URI — i.e. a dynamic QR was
 *  actually built. Asserting on copy alone cannot tell a real QR from a
 *  placeholder (§7.54's whole family of bug). */
async function dynamicQrCount() {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll("img")).filter((i) =>
        (i.getAttribute("src") ?? "").startsWith("data:image")
      ).length
  );
}

try {
  check(/^PKG-\d{4}-\d{4,}$/.test(reference),
    `the fixture package carries a minted reference (${reference})`);

  await freshLogin("parent-pnfb@swimsync.test");

  // ── CASE A: nothing configured at all ────────────────────────────────────
  // The pre-Chunk-2 copy said "QR not uploaded yet. Contact your coach
  // directly", which sends the parent to chase someone who may not be able to
  // fix it. It must now name the actual fix, and it must NOT offer a payable
  // ID it does not have.
  console.log("\n[case A] no PayNow ID, no uploaded image");
  setPayNow({});
  let text = await openPackagePayNow();
  check(/S\$180\.00/.test(text), "the screen asks for the package price (4 × $45)");
  check(/hasn't set up PayNow yet/.test(text),
    "the empty state names the fix, and is distinct from 'no QR uploaded'",
    text.slice(0, 500));
  check(!/Contact your coach directly/.test(text),
    "…and the old dead-end copy is gone");
  check(!/Transfer to this PayNow ID/.test(text),
    "no payable ID is offered when the business has none");
  check((await dynamicQrCount()) === 0, "no QR is rendered");

  // ── CASE B: THE ONE THAT DECIDES WHETHER RISK 3 IS REAL ──────────────────
  // A stored-but-UNENCODABLE mobile: nine digits, saved without complaint.
  // selectPayNowProxy says "configured", buildPayNowPayload throws, and there
  // is no uploaded image to fall back to. Before this chunk the parent landed
  // on the dead end. Now they get a payable PayNow ID, the amount and the
  // reference — the pre-2026-08-02 flow, which is worse than a QR and far
  // better than nothing.
  console.log("\n[case B] PayNow mobile stored but UNENCODABLE (9 digits), no image");
  setPayNow({ mobile: "912345678" });
  text = await openPackagePayNow();
  check((await dynamicQrCount()) === 0,
    "no QR is built — lib/paynow refuses a 9-digit mobile rather than encoding it");
  check(/Transfer to this PayNow ID/.test(text),
    "…and the screen offers the PayNow ID instead of a grey placeholder",
    text.slice(0, 500));
  check(/912345678/.test(text), "the ID itself is shown, to be retyped into a bank app");
  check(/S\$180\.00/.test(text), "the amount is shown");
  check(text.includes(reference), `the reference is shown (${reference})`);
  check(!/hasn't set up PayNow yet/.test(text),
    "…and it is NOT reported as unconfigured — it is configured, just unencodable");

  // ── CASE C: a valid mobile → the dynamic QR, which is the point of Chunk 2 ─
  console.log("\n[case C] valid 8-digit PayNow mobile");
  setPayNow({ mobile: "91234567" });
  text = await openPackagePayNow();
  check((await dynamicQrCount()) >= 1,
    "a PACKAGE now gets a dynamic QR — it used to return early and never build one");
  check(/amount and reference are locked into this QR/.test(text),
    "…and the copy says so");
  check(text.includes(reference), `the reference renders beside it (${reference})`);

  // ── The coach's Settings screen: the upload must ALWAYS be reachable ─────
  // Asserted in the SAME state as case B, which is the state where hiding it
  // would strand the business. The disclosure is the structural mitigation:
  // never conditionally removed, only collapsed.
  console.log("\n[coach] the fallback upload survives every PayNow state");
  setPayNow({ mobile: "912345678" });
  await freshLogin("coach@swimsync.test");
  await page.waitForTimeout(2500);
  await tap(page.getByText("Settings", { exact: true }).last(), "Settings tab");
  await page.waitForTimeout(2500);
  text = await page.evaluate(() => document.body.innerText);
  check(/Fallback QR image — advanced/.test(text),
    "the upload is present (collapsed) even with a PayNow ID stored",
    text.slice(0, 600));
  check(/Your PayNow ID is set/.test(text),
    "…and the card leads with the PayNow ID, not the image");

  await tap(page.getByText("Fallback QR image — advanced"), "expand the fallback");
  await page.waitForTimeout(1200);
  text = await page.evaluate(() => document.body.innerText);
  check(/Upload QR Code/.test(text), "expanding it reveals the upload button");

  // ── The admin-panel link: present for a coach-admin, ABSENT for a coach ──
  check(/Open admin panel/.test(text),
    "a coach who is also the tenant admin gets the admin-panel link");

  console.log("\n[coach] a PLAIN coach must not see the link at all");
  await freshLogin("coach-pnfb@swimsync.test");
  await page.waitForTimeout(2500);
  await tap(page.getByText("Settings", { exact: true }).last(), "Settings tab");
  await page.waitForTimeout(2500);
  text = await page.evaluate(() => document.body.innerText);
  check(!/Open admin panel/.test(text),
    "ABSENT, not disabled — a disabled link still leaks that the panel exists (§7.91)",
    text.slice(0, 600));
  check(/Fallback QR image — advanced/.test(text),
    "…but the fallback disclosure is still there for them (the upload refuses on press, by role)");
} finally {
  // Always put the seed tenant back, whatever happened above.
  setPayNow({});
  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -q < ${path.join(
      import.meta.dirname,
      "fixtures-paynow-fallback-teardown.sql"
    )}`,
    { stdio: "inherit" }
  );
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
