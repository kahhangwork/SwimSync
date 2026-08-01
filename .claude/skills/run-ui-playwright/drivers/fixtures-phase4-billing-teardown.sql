-- Teardown for fixtures-phase4-billing.sql (drives verify-tenant-branding.mjs).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-phase4-billing-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- THIS IS THE ONLY FIXTURE THAT CREATES A SECOND TENANT, which makes it the
-- most expensive one to leave lying around: 'Harbour Swim Club' shows up on the
-- platform admin's business list, in every cross-tenant count, and in the
-- tenant-isolation assertions of anything run afterwards. A stray second
-- business is exactly the state those tests are supposed to be constructing for
-- themselves.
--
-- It also does `UPDATE tenants SET paynow_qr_url` on the SEED business, guarded
-- by `WHERE paynow_qr_url IS NULL` — so it only writes if the column was empty,
-- and the honest reverse is to clear it only if it still holds the value the
-- fixture wrote. Blindly setting NULL would wipe a QR a real session uploaded.

BEGIN;

-- Invoices and balances first: both reference parent AND tenant.
DELETE FROM invoices
 WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = 'harbour-swim');
DELETE FROM parent_tenant_balances
 WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = 'harbour-swim');

-- The two children the fixture created, by exact name AND the parent link, so a
-- similarly-named child belonging to someone else cannot be caught.
CREATE TEMP TABLE _p4_students ON COMMIT DROP AS
SELECT s.id
  FROM students s
  JOIN parent_students ps ON ps.student_id = s.id
  JOIN parents p          ON p.id = ps.parent_id
  JOIN profiles pr        ON pr.id = p.profile_id
 WHERE pr.email = 'phase4-parent@test.local'
   AND s.full_name IN ('Phase4 KidA', 'Phase4 KidB');

DELETE FROM student_class_enrolments WHERE student_id IN (SELECT id FROM _p4_students);
DELETE FROM parent_students          WHERE student_id IN (SELECT id FROM _p4_students);
DELETE FROM students                 WHERE id         IN (SELECT id FROM _p4_students);

-- The fixture's own invoices at the SEED business (the same-month pair is the
-- point of the scenario), identified by month + amount rather than by tenant so
-- a real invoice is never taken.
DELETE FROM invoices i
 USING parents p, profiles pr
 WHERE i.parent_id = p.id AND p.profile_id = pr.id
   AND pr.email = 'phase4-parent@test.local'
   AND i.billing_month = '2026-06';

DELETE FROM parent_tenant_balances ptb
 USING parents p, profiles pr
 WHERE ptb.parent_id = p.id AND p.profile_id = pr.id
   AND pr.email = 'phase4-parent@test.local';

-- BOTH memberships, not just Harbour. The fixture joins the parent to the seed
-- business as well (that pair is the scenario), and a teardown that removes only
-- the second one leaves the parent silently a member of the seed tenant — which
-- the round-trip check caught as a one-row drift in parent_tenants.
DELETE FROM parent_tenants pt
 USING parents p, profiles pr
 WHERE pt.parent_id = p.id AND p.profile_id = pr.id
   AND pr.email = 'phase4-parent@test.local'
   AND pt.tenant_id IN (SELECT id FROM tenants
                         WHERE slug IN ('harbour-swim', 'marcus-swim'));

-- Only clear the seed QR if it still holds the value THIS fixture wrote.
UPDATE tenants SET paynow_qr_url = NULL
 WHERE slug = 'marcus-swim'
   AND paynow_qr_url = 'https://example.test/marcus-qr.png';

DELETE FROM tenants WHERE slug = 'harbour-swim';

-- The parent themselves. The fixture now seeds this auth user when it is absent
-- (CI has no browser to register them through the UI), so the round-trip is only
-- honest if the teardown removes them again.
--
-- BY EMAIL, NOT BY ID, and unconditionally: the user may have been created by
-- the fixture (fixed uuid) or by the driver registering through the app (random
-- uuid), and both must go. Leaving them behind also breaks the DRIVER — it
-- registers this email on every run, and a second run against the same database
-- would fail at "already registered".
--
-- audit_log BEFORE the profile: actor_id is NOT NULL / NO ACTION (§7.50).
DELETE FROM audit_log
 WHERE actor_id IN (SELECT id FROM auth.users WHERE email = 'phase4-parent@test.local');
DELETE FROM auth.users WHERE email = 'phase4-parent@test.local';

COMMIT;

-- Expect 0, 0, 0, 0 — and seed_tenant_intact = 1.
SELECT
  (SELECT count(*) FROM auth.users
    WHERE email = 'phase4-parent@test.local')                           AS p4_parent,
  (SELECT count(*) FROM tenants WHERE slug = 'harbour-swim')            AS second_tenant,
  (SELECT count(*) FROM students
    WHERE full_name IN ('Phase4 KidA', 'Phase4 KidB'))                  AS p4_students,
  (SELECT count(*) FROM invoices i JOIN parents p ON p.id = i.parent_id
     JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.email = 'phase4-parent@test.local')                        AS p4_invoices,
  (SELECT count(*) FROM tenants WHERE slug = 'marcus-swim')             AS seed_tenant_intact;
