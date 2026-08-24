// Drives the package RENEWAL-OFFER loop end to end on the admin UI
// (PACKAGE_RENEWAL_AUTOMATION_PLAN.md, Phase 4).
//
// pgTAP owns the offer/supersede/candidate rules and the Deno suite owns the
// public-package function; this exists for what only the real admin UI proves:
//   • a low-balance family surfaces in the Generate-all preview;
//   • Confirm calls create_package_offer → a PENDING offer with offered_by +
//     a minted public_token appears;
//   • Payment received activates it WITH THE OFFER'S start_date, not a
//     re-suggested one (⚠ RISK 3).
//
// Self-contained: seeds its own family into the seed tenant and tears it down,
// so it owns every row it touches (§7.73). Runs against coach@swimsync.test —
// the tenant admin, never superadmin@ (which is refused tenant pages).
//
// Prereqs: supabase up, admin dev server, edge functions served.
//   node drivers/verify-package-renewal.mjs

import { execSync } from "node:child_process";
import { launch, loginAdmin, tap, ADMIN } from "./lib.mjs";

const sql = (q) =>
  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tA -c ${JSON.stringify(
      q.replace(/\s+/g, " ")
    )}`
  )
    .toString()
    .trim();

// Fixed ids so teardown is exact. Everything the driver depends on it OWNS
// (§7.73): the class is created here rather than borrowed by a hardcoded id
// (seed.sql regenerates class UUIDs on every reset). The seed tenant and its
// Default Group category are the only borrowed ids, and both are stable seed
// constants; the coach is looked up by email.
const T = "70000000-0000-0000-0000-000000000001"; // the seed tenant
const GROUP_CAT = "7c000000-0000-0000-0000-000000000002"; // stable seed id
const CLASS = "f9c00000-0000-0000-0000-000000000001"; // OWNED
const PROD = "f9e00000-0000-0000-0000-000000000001";
const AUTHU = "f9b00000-0000-0000-0000-000000000001";
const STU = "f9500000-0000-0000-0000-000000000001";
const PKG = "f9700000-0000-0000-0000-000000000001";

function teardown() {
  sql(`DELETE FROM parent_packages WHERE product_id='${PROD}'
       OR parent_id IN (SELECT id FROM parents WHERE profile_id='${AUTHU}')`);
  sql(`DELETE FROM student_class_enrolments WHERE student_id='${STU}' OR class_id='${CLASS}'`);
  sql(`DELETE FROM parent_students WHERE student_id='${STU}'`);
  sql(`DELETE FROM students WHERE id='${STU}'`);
  sql(`DELETE FROM parent_tenants WHERE parent_id IN (SELECT id FROM parents WHERE profile_id='${AUTHU}')`);
  sql(`DELETE FROM package_products WHERE id='${PROD}'`);
  sql(`DELETE FROM classes WHERE id='${CLASS}'`);
  sql(`DELETE FROM auth.users WHERE id='${AUTHU}'`); // cascades parents/profiles
}

function seed() {
  teardown();
  // An OWNED Group class (coach looked up by email — its id regenerates).
  sql(`INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
        location_id, price_per_lesson, tenant_id, category_id)
       SELECT '${CLASS}', co.id, 'Renewal Sat', 'saturday', '09:00', '10:00',
              '71000000-0000-0000-0000-000000000001', 40, '${T}', '${GROUP_CAT}'
       FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
       WHERE pr.email = 'coach@swimsync.test'`);
  // A Group product, 4-week validity.
  sql(`INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
        rate_per_lesson, validity_months, validity_weeks, is_active)
       VALUES ('${PROD}','${T}','Renewal 8 Group','${GROUP_CAT}',
               8, 40, 12, 4, true)`);
  // Parent (never logs in) + student + enrolment in the existing Group class.
  sql(`INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,
        email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
        confirmation_token,recovery_token,email_change_token_new,email_change)
       VALUES ('00000000-0000-0000-0000-000000000000','${AUTHU}','authenticated',
        'authenticated','renewal-parent@test.local',crypt('x',gen_salt('bf')),now(),
        '{"provider":"email"}','{"full_name":"Renewal Parent","role":"parent","phone":"91230099"}',
        now(),now(),'','','','')`);
  sql(`INSERT INTO parent_tenants (parent_id, tenant_id)
       SELECT id, '${T}' FROM parents WHERE profile_id='${AUTHU}'`);
  sql(`INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
       VALUES ('${STU}','Renewal Kid','2018-01-01','assigned','${T}','${AUTHU}')`);
  sql(`INSERT INTO parent_students (parent_id, student_id)
       SELECT id, '${STU}' FROM parents WHERE profile_id='${AUTHU}'`);
  sql(`INSERT INTO student_class_enrolments (student_id, class_id)
       VALUES ('${STU}','${CLASS}')`);
  // An active package that STARTED 21 days ago → 4-week validity expires in ~7
  // days → low by the default 14-day expiry warning.
  sql(`INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
       SELECT '${PKG}','${T}', id, '${PROD}', 'active', CURRENT_DATE - 21
       FROM parents WHERE profile_id='${AUTHU}'`);
}

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

seed();
const { browser, page } = await launch({ headless: true });

try {
  await loginAdmin(page, "coach@swimsync.test", "password123");
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // ── Generate-all preview lists the low family ─────────────────────────────
  await tap(page.getByRole("button", { name: "Generate renewal offers" }),
    "Generate renewal offers");
  await page.waitForTimeout(1500);
  let text = await page.evaluate(() => document.body.innerText);
  check(/Renewal Parent/.test(text),
    "preview: the low-balance family is listed", text.slice(0, 500));
  check(/Renewal Kid/.test(text),
    "preview: the family's child is named");

  // ── Confirm → create_package_offer ────────────────────────────────────────
  await tap(page.getByRole("button", { name: /^Create \d+ offer/ }), "Create offers");
  await page.waitForTimeout(2500);

  const offerId = sql(`SELECT id FROM parent_packages
    WHERE product_id='${PROD}' AND status='pending' AND offered_by IS NOT NULL`);
  check(/^[0-9a-f-]{36}$/.test(offerId),
    "an offer row was created (pending, offered_by set)", offerId);
  const token = sql(`SELECT public_token FROM parent_packages WHERE id='${offerId}'`);
  check(/^[0-9a-f]{32}$/.test(token), "the offer carries a minted public_token", token);
  const offerStart = sql(`SELECT start_date FROM parent_packages WHERE id='${offerId}'`);

  // Close the WhatsApp queue if it opened.
  const done = page.getByRole("button", { name: /^Done$/ });
  if (await done.count()) await tap(done.first(), "close queue");

  // ── Payment received → active WITH THE OFFER'S start_date (⚠ RISK 3) ───────
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  text = await page.evaluate(() => document.body.innerText);
  check(/Awaiting confirmation/.test(text), "the offer sits in Awaiting confirmation");

  await tap(page.getByRole("button", { name: "Payment received" }).first(),
    "Payment received");
  await page.waitForTimeout(1000);
  text = await page.evaluate(() => document.body.innerText);
  check(new RegExp(`Offered start: ${offerStart}`).test(text),
    "the confirm dialog shows the offered start read-only (RISK 3)", text.slice(0, 400));
  await tap(page.getByRole("button", { name: "Payment received" }).last(),
    "confirm Payment received");
  await page.waitForTimeout(2000);

  const activeStart = sql(`SELECT start_date FROM parent_packages
    WHERE id='${offerId}' AND status='active'`);
  check(activeStart === offerStart,
    "the activated package keeps the OFFER's start_date (RISK 3)",
    `offer=${offerStart} active=${activeStart}`);
} finally {
  await browser.close();
  teardown();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
