-- Fixture for verify-platform-controls.mjs — the five Platform surfaces no other
-- driver opens (BACKLOG → Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U8).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-platform-controls.sql
--
-- TWO BUSINESSES OF ITS OWN (prefix d5000000-), because every surface here is a
-- cross-business one and the driver WRITES tenant-level state (owners, a moved
-- child). Nothing the seed tenant owns is touched (plan rule 12). The driver
-- logs in as the seed PLATFORM admin (superadmin@swimsync.test), which is a
-- read of a seed identity, not a write to it.
--
-- The shapes, each for one check:
--   PlatCtl Alpha Swim     owned by its admin-coach (rate-less, EXCLUDED from
--     (slug platform-ctl-a) `staff_without_rate` in SQL, §7.131), plus a
--                          rate-less STAFF coach (counted) and a RATED staff
--                          coach (not counted) → the row reads "1 unpaid".
--                          Also a co-admin — the owner-transfer target.
--   PlatCtl Bravo Swim     NO owner (owner_profile_id NULL → "no admin" + Set
--     (slug platform-ctl-b) owner) but TWO live admins of its own, DISTINCT from
--                          Alpha's — the stale-response guard is unobservable
--                          when the two lists share a name. Its only coach is
--                          a rate-less ADMIN → no chip.
--   PlatCtl Stranded Parent  a parent with ZERO parent_tenants rows.
--   PlatCtl Creditkid      at Alpha, TWO linked parents holding S$100.00 +
--                          S$37.50 credit there — the advisory must SUM them.
--   PlatCtl Checkkid       at Alpha, no parents — its parent-link read is
--                          forced to 500 by the driver (the checkFailed branch).
--   PlatCtl Twofam Parent  a member of BOTH businesses (Bravo inactive), one
--                          child at each — the only shape that exposes the
--                          family-status tenant narrowing (familyRows.ts).
--
-- IDEMPOTENT AND RESETTING: re-loading undoes every write the driver makes
-- (owners, the moved child, the memberships the move added, audit rows), so a
-- re-run without `supabase db reset` starts from the same state.
-- Teardown: fixtures-platform-controls-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The two businesses ──────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('d5000000-0000-0000-0000-000000000001','platform-ctl-a','PlatCtl Alpha Swim','SWIM-PCTA'),
  ('d5000000-0000-0000-0000-000000000002','platform-ctl-b','PlatCtl Bravo Swim','SWIM-PCTB')
ON CONFLICT (id) DO NOTHING;

-- ── The people (handle_new_user makes profiles / coaches / parents) ────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated','authenticated',
       v.email, crypt('password123', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', v.meta::jsonb, now(), now(), '','','',''
  FROM (VALUES
    ('d5000000-0000-0000-0000-0000000000a1','platform-ctl-a-owner@swimsync.test',
     '{"full_name":"PlatCtl Alpha Owner","role":"tenant_admin","is_coach":true,"tenant_id":"d5000000-0000-0000-0000-000000000001"}'),
    ('d5000000-0000-0000-0000-0000000000a2','platform-ctl-a-coadmin@swimsync.test',
     '{"full_name":"PlatCtl Alpha Coadmin","role":"tenant_admin","tenant_id":"d5000000-0000-0000-0000-000000000001"}'),
    ('d5000000-0000-0000-0000-0000000000a3','platform-ctl-a-staff@swimsync.test',
     '{"full_name":"PlatCtl Alpha Staff","role":"coach","tenant_id":"d5000000-0000-0000-0000-000000000001"}'),
    ('d5000000-0000-0000-0000-0000000000a4','platform-ctl-a-rated@swimsync.test',
     '{"full_name":"PlatCtl Alpha Rated","role":"coach","tenant_id":"d5000000-0000-0000-0000-000000000001"}'),
    ('d5000000-0000-0000-0000-0000000000b1','platform-ctl-b-lead@swimsync.test',
     '{"full_name":"PlatCtl Bravo Lead","role":"tenant_admin","is_coach":true,"tenant_id":"d5000000-0000-0000-0000-000000000002"}'),
    ('d5000000-0000-0000-0000-0000000000b2','platform-ctl-b-deputy@swimsync.test',
     '{"full_name":"PlatCtl Bravo Deputy","role":"tenant_admin","tenant_id":"d5000000-0000-0000-0000-000000000002"}'),
    ('d5000000-0000-0000-0000-0000000000f1','platform-ctl-stranded@swimsync.test',
     '{"full_name":"PlatCtl Stranded Parent"}'),
    ('d5000000-0000-0000-0000-0000000000f2','platform-ctl-credit-mum@swimsync.test',
     '{"full_name":"PlatCtl Credit Mum"}'),
    ('d5000000-0000-0000-0000-0000000000f3','platform-ctl-credit-dad@swimsync.test',
     '{"full_name":"PlatCtl Credit Dad"}'),
    ('d5000000-0000-0000-0000-0000000000f4','platform-ctl-twofam@swimsync.test',
     '{"full_name":"PlatCtl Twofam Parent"}')
  ) AS v(id, email, meta)
ON CONFLICT (id) DO NOTHING;

-- Owners RESET every load: the driver moves Alpha's to the co-admin and gives
-- Bravo one. handle_new_user's first-admin claim set Bravo's; clear it — the
-- ownerless state is the "no admin" / Set owner shape. (postgres passes
-- guard_tenants_owner, §7.38.)
UPDATE tenants SET owner_profile_id = 'd5000000-0000-0000-0000-0000000000a1'
 WHERE id = 'd5000000-0000-0000-0000-000000000001'
   AND owner_profile_id IS DISTINCT FROM 'd5000000-0000-0000-0000-0000000000a1';
UPDATE tenants SET owner_profile_id = NULL
 WHERE id = 'd5000000-0000-0000-0000-000000000002' AND owner_profile_id IS NOT NULL;

-- The rated staff coach: one rate, so only the rate-LESS staff coach is flagged.
INSERT INTO coach_rates (id, coach_id, amount, effective_from)
SELECT 'd5000000-0000-0000-0000-0000000007a4', co.id, 40.00, DATE '2026-01-01'
  FROM coaches co WHERE co.profile_id = 'd5000000-0000-0000-0000-0000000000a4'
ON CONFLICT (id) DO NOTHING;

-- ── The children. Tenant RESET every load (the driver moves Creditkid). ────
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
VALUES
  ('d5000000-0000-0000-0000-0000000000e1','PlatCtl Creditkid','d5000000-0000-0000-0000-000000000001','unassigned',TRUE),
  ('d5000000-0000-0000-0000-0000000000e2','PlatCtl Checkkid','d5000000-0000-0000-0000-000000000001','unassigned',TRUE),
  ('d5000000-0000-0000-0000-0000000000e3','PlatCtl Kid Alpha','d5000000-0000-0000-0000-000000000001','unassigned',TRUE),
  ('d5000000-0000-0000-0000-0000000000e4','PlatCtl Kid Bravo','d5000000-0000-0000-0000-000000000002','unassigned',TRUE)
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id,
                               assignment_status = EXCLUDED.assignment_status,
                               is_active = EXCLUDED.is_active;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, v.sid
  FROM (VALUES
    ('d5000000-0000-0000-0000-0000000000f2'::uuid,'d5000000-0000-0000-0000-0000000000e1'::uuid),
    ('d5000000-0000-0000-0000-0000000000f3'::uuid,'d5000000-0000-0000-0000-0000000000e1'::uuid),
    ('d5000000-0000-0000-0000-0000000000f4'::uuid,'d5000000-0000-0000-0000-0000000000e3'::uuid),
    ('d5000000-0000-0000-0000-0000000000f4'::uuid,'d5000000-0000-0000-0000-0000000000e4'::uuid)
  ) AS v(pid, sid)
  JOIN parents p ON p.profile_id = v.pid
 WHERE NOT EXISTS (SELECT 1 FROM parent_students ps
                    WHERE ps.parent_id = p.id AND ps.student_id = v.sid);

-- ── Memberships. RESET: the move gives Creditkid's parents one at Bravo. ───
DELETE FROM parent_tenants pt USING parents p
 WHERE pt.parent_id = p.id
   AND p.profile_id IN ('d5000000-0000-0000-0000-0000000000f2','d5000000-0000-0000-0000-0000000000f3')
   AND pt.tenant_id = 'd5000000-0000-0000-0000-000000000002';

INSERT INTO parent_tenants (parent_id, tenant_id, is_active, inactivated_at)
SELECT p.id, v.tid, v.active, CASE WHEN v.active THEN NULL ELSE now() END
  FROM (VALUES
    ('d5000000-0000-0000-0000-0000000000f2'::uuid,'d5000000-0000-0000-0000-000000000001'::uuid,TRUE),
    ('d5000000-0000-0000-0000-0000000000f3'::uuid,'d5000000-0000-0000-0000-000000000001'::uuid,TRUE),
    ('d5000000-0000-0000-0000-0000000000f4'::uuid,'d5000000-0000-0000-0000-000000000001'::uuid,TRUE),
    ('d5000000-0000-0000-0000-0000000000f4'::uuid,'d5000000-0000-0000-0000-000000000002'::uuid,FALSE)
  ) AS v(pid, tid, active)
  JOIN parents p ON p.profile_id = v.pid
ON CONFLICT (parent_id, tenant_id) DO NOTHING;

-- Credit at ALPHA, split across the two parents: S$137.50 in all.
INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
SELECT p.id, 'd5000000-0000-0000-0000-000000000001', v.amt
  FROM (VALUES
    ('d5000000-0000-0000-0000-0000000000f2'::uuid, 100.00),
    ('d5000000-0000-0000-0000-0000000000f3'::uuid,  37.50)
  ) AS v(pid, amt)
  JOIN parents p ON p.profile_id = v.pid
ON CONFLICT (parent_id, tenant_id) DO UPDATE SET credit_balance = EXCLUDED.credit_balance;

-- The driver's audit trail (owner transfers, the move, the student update).
DELETE FROM audit_log
 WHERE entity_id::text LIKE 'd5000000-%'
    OR tenant_id IN ('d5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002');

-- ── Postconditions — fail at load time, not twenty checks later ────────────
DO $$
DECLARE v_stranded int; v_bravo_admins int; v_credit numeric; v_alpha_owner uuid;
        v_bravo_owner uuid; v_twofam int; v_kid uuid;
BEGIN
  SELECT count(*) INTO v_stranded FROM parent_tenants pt JOIN parents p ON p.id = pt.parent_id
   WHERE p.profile_id = 'd5000000-0000-0000-0000-0000000000f1';
  SELECT count(*) INTO v_bravo_admins FROM profiles
   WHERE tenant_id = 'd5000000-0000-0000-0000-000000000002' AND role = 'tenant_admin';
  SELECT sum(b.credit_balance) INTO v_credit FROM parent_tenant_balances b
    JOIN parent_students ps ON ps.parent_id = b.parent_id
   WHERE ps.student_id = 'd5000000-0000-0000-0000-0000000000e1'
     AND b.tenant_id = 'd5000000-0000-0000-0000-000000000001';
  SELECT owner_profile_id INTO v_alpha_owner FROM tenants WHERE id = 'd5000000-0000-0000-0000-000000000001';
  SELECT owner_profile_id INTO v_bravo_owner FROM tenants WHERE id = 'd5000000-0000-0000-0000-000000000002';
  SELECT count(*) INTO v_twofam FROM parent_tenants pt JOIN parents p ON p.id = pt.parent_id
   WHERE p.profile_id = 'd5000000-0000-0000-0000-0000000000f4';
  SELECT tenant_id INTO v_kid FROM students WHERE id = 'd5000000-0000-0000-0000-0000000000e1';
  IF v_stranded <> 0 OR v_bravo_admins <> 2 OR v_credit IS DISTINCT FROM 137.50
     OR v_alpha_owner IS DISTINCT FROM 'd5000000-0000-0000-0000-0000000000a1'
     OR v_bravo_owner IS NOT NULL OR v_twofam <> 2
     OR v_kid IS DISTINCT FROM 'd5000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'fixture: stranded memberships % (want 0), Bravo admins % (2), credit % (137.50), '
                    'Alpha owner % (a1), Bravo owner % (NULL), Twofam memberships % (2), Creditkid at %',
      v_stranded, v_bravo_admins, v_credit, v_alpha_owner, v_bravo_owner, v_twofam, v_kid;
  END IF;
END $$;

COMMIT;
