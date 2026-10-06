-- pgTAP: a tenant admin can read the name of a parent who joined their business
-- before the parent has added a child (20260926000100) — and nobody else gains
-- anything from it.
--
-- Personas, two businesses A and B:
--   P  joined A, no child anywhere        → the case the migration exists for
--   R  joined A and B, child only at B    → A's admin sees R's NAME, but not R's
--                                           child links (parent_students is NOT
--                                           widened — the reason the migration
--                                           adds a helper instead of widening
--                                           tenant_serves_parent)
--   Q  joined B only, no child            → A's admin sees nothing of Q
--
-- PROVEN RED (§7.25): with the rollback applied, assertions 1-3 fail
-- (A's admin sees 0 parents for P, and no name for P or R).

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('1c000000-0000-0000-0000-00000000000a','member-a','Member School A','SWIM-MEMA'),
  ('1c000000-0000-0000-0000-00000000000b','member-b','Member School B','SWIM-MEMB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated','authenticated',
       u.email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', u.meta::jsonb,
       app_now(), app_now(), '', '', '', ''
  FROM (VALUES
    ('2c000000-0000-0000-0000-0000000000a1','mem-admin-a@test.local',
     '{"full_name":"Admin A","role":"tenant_admin","tenant_id":"1c000000-0000-0000-0000-00000000000a"}'),
    ('2c000000-0000-0000-0000-0000000000a2','mem-coach-a@test.local',
     '{"full_name":"Coach A","role":"coach","tenant_id":"1c000000-0000-0000-0000-00000000000a"}'),
    ('2c000000-0000-0000-0000-0000000000b1','mem-admin-b@test.local',
     '{"full_name":"Admin B","role":"tenant_admin","tenant_id":"1c000000-0000-0000-0000-00000000000b"}'),
    ('2c000000-0000-0000-0000-0000000000d1','mem-p@test.local', '{"full_name":"Parent P","role":"parent"}'),
    ('2c000000-0000-0000-0000-0000000000d2','mem-r@test.local', '{"full_name":"Parent R","role":"parent"}'),
    ('2c000000-0000-0000-0000-0000000000d3','mem-q@test.local', '{"full_name":"Parent Q","role":"parent"}')
  ) AS u(id, email, meta);

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, m.tenant_id::uuid
  FROM (VALUES
    ('2c000000-0000-0000-0000-0000000000d1','1c000000-0000-0000-0000-00000000000a'),
    ('2c000000-0000-0000-0000-0000000000d2','1c000000-0000-0000-0000-00000000000a'),
    ('2c000000-0000-0000-0000-0000000000d2','1c000000-0000-0000-0000-00000000000b'),
    ('2c000000-0000-0000-0000-0000000000d3','1c000000-0000-0000-0000-00000000000b')
  ) AS m(profile_id, tenant_id)
  JOIN parents p ON p.profile_id = m.profile_id::uuid;

INSERT INTO tenant_levels (id, tenant_id, label, sort_order)
VALUES ('3c000000-0000-0000-0000-00000000000b','1c000000-0000-0000-0000-00000000000b','Level 1', 1);
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, level_id)
VALUES ('4c000000-0000-0000-0000-00000000000b','R Child at B','2017-03-03','assigned',
        '1c000000-0000-0000-0000-00000000000b','3c000000-0000-0000-0000-00000000000b');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '4c000000-0000-0000-0000-00000000000b'
  FROM parents p WHERE p.profile_id = '2c000000-0000-0000-0000-0000000000d2';

-- ── As A's admin ─────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"2c000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM parents WHERE profile_id = '2c000000-0000-0000-0000-0000000000d1'),
  1, 'A''s admin sees the parents row of P, a childless member of A');

SELECT is(
  (SELECT full_name FROM profiles WHERE id = '2c000000-0000-0000-0000-0000000000d1'),
  'Parent P', 'A''s admin reads P''s name — the "Unknown" on Packages → Awaiting');

SELECT is(
  (SELECT full_name FROM profiles WHERE id = '2c000000-0000-0000-0000-0000000000d2'),
  'Parent R', 'A''s admin reads R''s name (member of A; child only at B)');

SELECT is(
  (SELECT count(*)::int FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
    WHERE p.profile_id = '2c000000-0000-0000-0000-0000000000d2'),
  0, 'A''s admin does NOT see R''s child link at B — parent_students is not widened');

SELECT is(
  (SELECT count(*)::int FROM profiles WHERE id = '2c000000-0000-0000-0000-0000000000d3')
  + (SELECT count(*)::int FROM parents WHERE profile_id = '2c000000-0000-0000-0000-0000000000d3'),
  0, 'A''s admin sees nothing of Q, who joined only B');

-- ── As A's coach — admins only ──────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"2c000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM profiles WHERE id = '2c000000-0000-0000-0000-0000000000d1'),
  0, 'A''s coach does not gain P''s name — the arm is admin-only');

-- ── As B's admin ────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"2c000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM profiles WHERE id = '2c000000-0000-0000-0000-0000000000d1'),
  0, 'B''s admin sees nothing of P, who joined only A');

-- ── A suspended: its admin loses the arm (is_tenant_admin refuses) ──────────
RESET ROLE;
UPDATE tenants SET suspended_at = app_now() WHERE id = '1c000000-0000-0000-0000-00000000000a';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"2c000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM parents WHERE profile_id = '2c000000-0000-0000-0000-0000000000d1'),
  0, 'a suspended business''s admin no longer sees P');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
