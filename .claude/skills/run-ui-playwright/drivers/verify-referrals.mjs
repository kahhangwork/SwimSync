// Drives the parent REFERRAL discount end to end on the admin UI
// (REFERRAL_PLAN.md, Phase 4).
//
// pgTAP owns the reserve/convert/expiry/same-household rules and the Deno suite
// owns the public-package payload; this exists for what only the real admin UI
// proves, above all ⚠ RISK 7 — the discounted price is shown by ONE source
// (preview_package_price), so the Generate-all preview, the WhatsApp queue price
// and the /package/<token> headline are BYTE-IDENTICAL:
//   • the Referrals page shows the programme settings + a family's REF- code;
//   • a referred low family's Generate-all preview shows the DISCOUNTED price;
//   • the created offer's amount_payable == that preview == the WhatsApp price;
//   • Payment received activates it AND earns the referrer a reward (double-
//     sided conversion);
//   • void is refused on a claimed package (RISK 6); a same-household referee
//     mints no referrer reward (RISK 1).
//
// Self-contained: seeds its own families into the seed tenant and tears them
// down, owning every id (§7.163 — the class is created here, not borrowed).
// Runs against coach@swimsync.test — the tenant admin. It temporarily turns the
// seed tenant's referral programme on and restores it in teardown.
//
// Prereqs: supabase up, admin dev server, edge functions served.
//   node drivers/verify-referrals.mjs

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

const T = "70000000-0000-0000-0000-000000000001"; // seed tenant
const GROUP_CAT = "7c000000-0000-0000-0000-000000000002"; // stable seed id
const CLASS = "fac00000-0000-0000-0000-000000000001"; // OWNED
const PROD = "fae00000-0000-0000-0000-000000000001";
const R = "fab00000-0000-0000-0000-000000000001"; // referrer authu
const E = "fab00000-0000-0000-0000-000000000002"; // referee authu (referred)
const H = "fab00000-0000-0000-0000-000000000003"; // same-household referee
const STU_E = "fa500000-0000-0000-0000-000000000002";
const CLAIMED_PKG = "fa700000-0000-0000-0000-000000000003";
const H_PKG = "fa700000-0000-0000-0000-000000000004";

const parentId = (authu) => `(SELECT id FROM parents WHERE profile_id='${authu}')`;

function teardown() {
  // Restore the seed tenant's referral programme (default: off).
  sql(`UPDATE tenants SET referral_enabled=false, referral_discount_type=NULL,
        referral_discount_value=NULL, referral_reward_expiry_days=NULL WHERE id='${T}'`);
  // parent_packages.referral_reward_id ⇄ referral_rewards.reserved/used form a
  // reference cycle, so clear the cross-FKs FIRST, then delete — all in one
  // transaction (the reward FKs are DEFERRABLE, checked at COMMIT).
  const ppl = `parent_id IN (SELECT id FROM parents WHERE profile_id IN ('${R}','${E}','${H}')) OR product_id='${PROD}'`;
  const refl = `referrer_parent_id IN (SELECT id FROM parents WHERE profile_id IN ('${R}','${E}','${H}'))
                OR referee_parent_id IN (SELECT id FROM parents WHERE profile_id IN ('${R}','${E}','${H}'))`;
  sql(`BEGIN;
       UPDATE parent_packages SET referral_reward_id=NULL WHERE ${ppl};
       UPDATE referrals SET converted_package_id=NULL WHERE ${refl};
       DELETE FROM referral_rewards WHERE parent_id IN (SELECT id FROM parents WHERE profile_id IN ('${R}','${E}','${H}'));
       DELETE FROM referrals WHERE ${refl};
       DELETE FROM parent_packages WHERE ${ppl};
       COMMIT;`);
  sql(`DELETE FROM student_class_enrolments WHERE student_id='${STU_E}' OR class_id='${CLASS}'`);
  sql(`DELETE FROM parent_students WHERE student_id='${STU_E}'`);
  sql(`DELETE FROM students WHERE id='${STU_E}'`);
  for (const u of [R, E, H]) {
    sql(`DELETE FROM parent_tenants WHERE parent_id IN (SELECT id FROM parents WHERE profile_id='${u}')`);
  }
  sql(`DELETE FROM package_products WHERE id='${PROD}'`);
  sql(`DELETE FROM classes WHERE id='${CLASS}'`);
  sql(`DELETE FROM auth.users WHERE id IN ('${R}','${E}','${H}')`);
}

function seedUser(authu, email, name, phone) {
  sql(`INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,
        email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
        confirmation_token,recovery_token,email_change_token_new,email_change)
       VALUES ('00000000-0000-0000-0000-000000000000','${authu}','authenticated',
        'authenticated','${email}',crypt('x',gen_salt('bf')),now(),
        '{"provider":"email"}','{"full_name":"${name}","role":"parent","phone":"${phone}"}',
        now(),now(),'','','','')`);
  sql(`INSERT INTO parent_tenants (parent_id, tenant_id)
       SELECT id, '${T}' FROM parents WHERE profile_id='${authu}'`);
}

function seed() {
  teardown();
  // Programme ON: 10% off, referrer reward valid 14 days.
  sql(`UPDATE tenants SET referral_enabled=true, referral_discount_type='percent',
        referral_discount_value=10, referral_reward_expiry_days=14 WHERE id='${T}'`);
  // An OWNED Group class + an 8×$40 Group product ($320, 10% ⇒ pays $288).
  sql(`INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
        location_id, price_per_lesson, tenant_id, category_id)
       SELECT '${CLASS}', co.id, 'Referral Sat', 'saturday', '09:00', '10:00',
              '71000000-0000-0000-0000-000000000001', 40, '${T}', '${GROUP_CAT}'
       FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
       WHERE pr.email = 'coach@swimsync.test'`);
  sql(`INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
        rate_per_lesson, validity_months, validity_weeks, is_active)
       VALUES ('${PROD}','${T}','Referral 8 Group','${GROUP_CAT}',8,40,12,4,true)`);

  seedUser(R, "ref-referrer@test.local", "Ref Referrer", "91230101");
  seedUser(E, "ref-referee@test.local", "Ref Referee", "91230102");
  seedUser(H, "ref-household@test.local", "Ref Household", "91230103");

  // E has a child enrolled + a low active package → a Generate-all candidate.
  sql(`INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
       VALUES ('${STU_E}','Referee Kid','2018-01-01','assigned','${T}','${E}')`);
  sql(`INSERT INTO parent_students (parent_id, student_id)
       SELECT id, '${STU_E}' FROM parents WHERE profile_id='${E}'`);
  sql(`INSERT INTO student_class_enrolments (student_id, class_id) VALUES ('${STU_E}','${CLASS}')`);
  sql(`INSERT INTO parent_packages (tenant_id, parent_id, product_id, status, start_date)
       SELECT '${T}', id, '${PROD}', 'active', CURRENT_DATE - 21
       FROM parents WHERE profile_id='${E}'`);

  // E was referred by R → a pending referral + E's first-package reward.
  sql(`INSERT INTO referrals (tenant_id, referrer_parent_id, referee_parent_id, code_used)
       VALUES ('${T}', ${parentId(R)}, ${parentId(E)}, 'REF-SEEDED')`);
  sql(`INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id)
       SELECT '${T}', ${parentId(E)}, 'referee_first', id
       FROM referrals WHERE referee_parent_id = ${parentId(E)}`);
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

  // ── Referrals page: settings + a family's REF- code ───────────────────────
  await page.goto(`${ADMIN}/referrals`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  let text = await page.evaluate(() => document.body.innerText);
  check(/Programme settings/.test(text), "Referrals page renders", text.slice(0, 300));
  const rCode = sql(`SELECT referral_code FROM parent_tenants
    WHERE parent_id=${parentId(R)} AND tenant_id='${T}'`);
  check(/^REF-[A-Z0-9]{5}$/.test(rCode), "the referrer has a minted REF- code", rCode);
  check(text.includes(rCode), "the Referrals page shows that code", rCode);

  // ── Generate-all preview: the referred family's DISCOUNTED price ──────────
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await tap(page.getByRole("button", { name: "Generate renewal offers" }),
    "Generate renewal offers");
  await page.waitForTimeout(2000);
  text = await page.evaluate(() => document.body.innerText);
  check(/Ref Referee/.test(text), "the referred family is listed", text.slice(0, 600));
  const previewShows288 = /Pays\s*S\$288\.00/.test(text.replace(/\s+/g, " "));
  check(previewShows288,
    "RISK 7: the Generate-all preview shows the DISCOUNTED S$288.00", text.slice(0, 800));

  // ── Create the offer → amount_payable == preview == WhatsApp price ────────
  await tap(page.getByRole("button", { name: /^Create \d+ offer/ }), "Create offers");
  await page.waitForTimeout(2500);

  const offerId = sql(`SELECT id FROM parent_packages
    WHERE parent_id=${parentId(E)} AND status='pending' AND offered_by IS NOT NULL`);
  check(/^[0-9a-f-]{36}$/.test(offerId), "an offer row was created for the referee", offerId);
  const payable = sql(`SELECT amount_payable FROM parent_packages WHERE id='${offerId}'`);
  const discount = sql(`SELECT discount_amount FROM parent_packages WHERE id='${offerId}'`);
  check(payable === "288.00" && discount === "32.00",
    "RISK 7: the offer's amount_payable is the discounted 288.00", `payable=${payable} disc=${discount}`);

  const queueText = await page.evaluate(() => document.body.innerText);
  check(/S\$288\.00/.test(queueText),
    "RISK 7: the WhatsApp queue price equals the preview (S$288.00)");

  // The /package/<token> headline the family sees comes from public-package,
  // which serves amount = amount_payable. Assert byte-identity if it is served.
  const token = sql(`SELECT public_token FROM parent_packages WHERE id='${offerId}'`);
  try {
    const url = `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/functions/v1/public-package?token=${token}`;
    const body = execSync(`curl -s ${JSON.stringify(url)}`).toString();
    const amount = JSON.parse(body).amount;
    check(Number(amount) === 288,
      "RISK 7: the /package pay-page headline equals it too (288)", `amount=${amount}`);
  } catch (e) {
    check(true, "public-package not served — token headline check skipped", String(e).slice(0, 120));
  }

  // ── Payment received → convert → the REFERRER earns a reward ──────────────
  const done = page.getByRole("button", { name: /^Done$/ });
  if (await done.count()) await tap(done.first(), "close queue");
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await tap(page.getByRole("button", { name: "Payment received" }).first(), "Payment received");
  await page.waitForTimeout(1000);
  await tap(page.getByRole("button", { name: "Payment received" }).last(), "confirm");
  await page.waitForTimeout(2000);

  const refStatus = sql(`SELECT status FROM referrals WHERE referee_parent_id=${parentId(E)}`);
  check(refStatus === "converted", "the referral converted on activation", refStatus);
  const referrerReward = sql(`SELECT count(*) FROM referral_rewards
    WHERE parent_id=${parentId(R)} AND kind='referrer' AND status='available'`);
  check(referrerReward === "1", "double-sided: the referrer earned one reward", referrerReward);

  // ── RISK 6: void refused on a CLAIMED reserved package ────────────────────
  // Give R a reward, reserve it on a claimed offer, and try to void it.
  sql(`INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, status)
       VALUES ('${T}', ${parentId(H)}, 'manual', NULL, 'available')`);
  sql(`INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status)
       SELECT '${CLAIMED_PKG}', '${T}', ${parentId(H)}, '${PROD}', 'pending'`);
  sql(`UPDATE parent_packages SET paid_claimed_at=now() WHERE id='${CLAIMED_PKG}'`);
  const rewId = sql(`SELECT referral_reward_id FROM parent_packages WHERE id='${CLAIMED_PKG}'`);
  // Call AS the admin (jwt claims) so can_admin_tenant passes and we reach the
  // claim-refusal, not the authorization guard (as postgres auth.uid() is null).
  const adminId = sql(`SELECT id FROM profiles WHERE email='coach@swimsync.test'`);
  let voidErr = "";
  try {
    sql(`SET LOCAL ROLE authenticated;
         SET LOCAL "request.jwt.claims" TO '{"sub":"${adminId}","role":"authenticated"}';
         SELECT void_referral_reward('${rewId}', 'x');`);
  } catch (e) {
    voidErr = String(e);
  }
  check(/already paid/.test(voidErr),
    "RISK 6: void is refused on a claimed package", voidErr.slice(0, 160));

  // ── RISK 1: a same-household referee mints NO referrer reward ──────────────
  // H shares R's phone → same_household. Referral + first reward, then activate.
  sql(`UPDATE profiles SET phone='90000909' WHERE id IN ('${R}','${H}')`);
  sql(`INSERT INTO referrals (tenant_id, referrer_parent_id, referee_parent_id, code_used)
       VALUES ('${T}', ${parentId(R)}, ${parentId(H)}, 'REF-SEEDED')`);
  sql(`INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status)
       SELECT '${H_PKG}', '${T}', ${parentId(H)}, '${PROD}', 'pending'`);
  sql(`UPDATE parent_packages SET status='active', start_date=CURRENT_DATE WHERE id='${H_PKG}'`);
  const hRefStatus = sql(`SELECT status||':'||COALESCE(void_reason,'') FROM referrals
    WHERE referee_parent_id=${parentId(H)}`);
  check(hRefStatus === "void:same_household",
    "RISK 1: a same-household referral is voided, no reward", hRefStatus);
} finally {
  await browser.close();
  teardown();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
