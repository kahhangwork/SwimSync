-- pgTAP: per-business locations entity.  Plan: docs/plans/LOCATION_ENTITY_PLAN.md
--
-- Promotes the free-text classes.location_name into a per-tenant `locations`
-- entity (name/address/notes) referenced by classes.location_id.  The properties
-- worth pinning: tenant isolation (RLS + the cross-tenant FK guard), the
-- DATABASE-enforced archive rule (a location an ACTIVE class uses cannot be
-- archived — the admin page's pre-check is UX only, PostgREST is a second
-- writer), and the partial-unique that makes a name reusable after archiving.
-- The expand-window sync-trigger cases (a class written with only location_name)
-- were dropped by the CONTRACT migration (20260824000200), which removed the
-- free-text columns and the trigger; only the location_id path remains.
--
-- Its own tenants, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- The check that would have caught the three RLS-off leaks (tenant_levels).
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'locations' AND relnamespace = 'public'::regnamespace),
  'locations has ROW LEVEL SECURITY enabled, not merely policies written');

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ac000000-0000-0000-0000-000000000001','loc-a','Loc Swim A','SWIM-LOCA'),
  ('ac000000-0000-0000-0000-000000000002','loc-b','Loc Swim B','SWIM-LOCB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','loc-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Loc Admin A","role":"tenant_admin","tenant_id":"ac000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','loc-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Loc Admin B","role":"tenant_admin","tenant_id":"ac000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','loc-coach-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Loc Coach A","role":"coach","tenant_id":"ac000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','loc-parent-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Loc Parent A","role":"parent"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000e1',
   'authenticated','authenticated','loc-stranger@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Loc Stranger","role":"parent"}', now(), now(), '','','','');

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('ad000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','Group');

INSERT INTO locations (id, tenant_id, name, address, sort_order) VALUES
  ('ae000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','Bishan Pool','1 Bishan St',1),
  ('ae000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000001','Clementi Pool','2 Clementi Ave',2),
  ('ae000000-0000-0000-0000-000000000003','ac000000-0000-0000-0000-000000000002','Woodlands Pool','3 Woodlands Rd',1);

-- An ACTIVE class in A at Bishan, so archiving Bishan is blocked below.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     price_per_lesson, category_id, tenant_id, location_id)
SELECT 'af000000-0000-0000-0000-000000000001', c.id, 'Loc Class', 'monday',
       '10:00','11:00', 25, 'ad000000-0000-0000-0000-000000000001',
       'ac000000-0000-0000-0000-000000000001','ae000000-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id = 'ab000000-0000-0000-0000-0000000000c1';

-- Parent A belongs to tenant A (so parent_in_tenant() is true for them).
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ac000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = 'ab000000-0000-0000-0000-0000000000d1';

-- ── RLS: each business sees only its own locations ───────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT is((SELECT count(*)::int FROM locations), 2,
  'an admin sees only their own business''s locations');

SELECT lives_ok($$
  INSERT INTO locations (tenant_id, name) VALUES
    ('ac000000-0000-0000-0000-000000000001','Tampines Pool')
$$, 'an admin can add a location to their own business');

SELECT throws_ok($$
  INSERT INTO locations (tenant_id, name) VALUES
    ('ac000000-0000-0000-0000-000000000002','Sneaky Pool')
$$, '42501', NULL,
  'an admin cannot add a location to ANOTHER business');

-- ── Partial-unique: one active name per business ─────────────────────────────
SELECT throws_ok($$
  INSERT INTO locations (tenant_id, name) VALUES
    ('ac000000-0000-0000-0000-000000000001','Bishan Pool')
$$, '23505', NULL,
  'a business cannot have two ACTIVE locations of the same name');

-- ── A parent of the business sees its locations; a stranger sees none ────────
SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT cmp_ok((SELECT count(*)::int FROM locations), '>=', 2,
  'a parent of the business can see where their classes are');

SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM locations), 0,
  'a self-registered stranger sees no locations');

RESET ROLE;

-- ── Cross-tenant FK guard: a class cannot point at another business's location
SELECT throws_ok($$
  UPDATE classes SET location_id = 'ae000000-0000-0000-0000-000000000003'
   WHERE id = 'af000000-0000-0000-0000-000000000001'
$$, 'P0001', 'that location belongs to another business',
  'a class cannot reference ANOTHER business''s location');

-- ── Archive guard: an ACTIVE class blocks the archive (DB-enforced) ──────────
SELECT throws_ok($$
  UPDATE locations SET archived_at = now()
   WHERE id = 'ae000000-0000-0000-0000-000000000001'
$$, '23514', NULL,
  'a location an ACTIVE class uses cannot be archived');

-- ── ON DELETE RESTRICT: a referenced location cannot be hard-deleted ─────────
SELECT throws_ok($$
  DELETE FROM locations WHERE id = 'ae000000-0000-0000-0000-000000000001'
$$, '23503', NULL,
  'a location a class references cannot be hard-deleted (RESTRICT backstop)');

-- ── The NEW-admin path: a class written with only location_id ────────────────
-- After the contract migration this is the ONLY way a class gets a location; the
-- free-text location_name column and its expand-window sync trigger are gone.
SELECT lives_ok($$
  INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                       price_per_lesson, category_id, tenant_id, location_id)
  SELECT 'af000000-0000-0000-0000-000000000003', c.id, 'IdOnly Class', 'wednesday',
         '10:00','11:00', 25,
         'ad000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001',
         'ae000000-0000-0000-0000-000000000002'
    FROM coaches c WHERE c.profile_id = 'ab000000-0000-0000-0000-0000000000c1'
$$, 'a class can be written with only location_id (new-admin path)');

-- ── Archive ALLOWED once only a RETIRED class references it ──────────────────
-- Retire both classes on Bishan, then Bishan archives cleanly.
UPDATE classes SET is_active = false, deactivated_at = now()
 WHERE location_id = 'ae000000-0000-0000-0000-000000000001';

SELECT lives_ok($$
  UPDATE locations SET archived_at = now()
   WHERE id = 'ae000000-0000-0000-0000-000000000001'
$$, 'a location only RETIRED classes use can be archived');

-- ── A retired class still resolves its (now archived) location ───────────────
SELECT is(
  (SELECT l.name FROM classes c JOIN locations l ON l.id = c.location_id
    WHERE c.id = 'af000000-0000-0000-0000-000000000001'),
  'Bishan Pool',
  'a retired class keeps a valid FK to its archived location');

-- ── The name is reusable once the old one is archived ────────────────────────
SELECT lives_ok($$
  INSERT INTO locations (tenant_id, name) VALUES
    ('ac000000-0000-0000-0000-000000000001','Bishan Pool')
$$, 'an archived name can be reused for a new active location');

SELECT * FROM finish();
ROLLBACK;
