-- pgTAP: class capacity + colour columns (20260819000100).
-- The CHECKs bound the shape; RLS lets the business's admin write them and
-- nobody else (a coach's UPDATE under classes_write is filtered to 0 rows, not
-- raised — assert the value is unchanged). Rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('cc000000-0000-0000-0000-0000000000a1','ccc','Cap Colour','SWIM-CCC1'),
  ('cc000000-0000-0000-0000-0000000000a2','ccd','Cap Colour Other','SWIM-CCC2');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','cb000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','cc-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"CC Admin","role":"tenant_admin","tenant_id":"cc000000-0000-0000-0000-0000000000a1"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cb000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','cc-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"CC Coach","role":"coach","tenant_id":"cc000000-0000-0000-0000-0000000000a1"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cb000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','cc-other-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"CC Other Admin","role":"tenant_admin","tenant_id":"cc000000-0000-0000-0000-0000000000a2"}',
   now(), now(), '','','','');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('ce000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000a1','Group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'cf000000-0000-0000-0000-0000000000a1', co.id, 'C', 'monday',
       '10:00','11:00','Pool', 50.00, 'ce000000-0000-0000-0000-0000000000a1'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='cc-coach@test.local';

-- ── Defaults: all NULL ──────────────────────────────────────────────────────
SELECT is((SELECT default_capacity FROM class_categories WHERE id='ce000000-0000-0000-0000-0000000000a1'),
  NULL, '1: category default_capacity is NULL (unlimited) by default');
SELECT ok((SELECT capacity IS NULL AND colour IS NULL FROM classes WHERE id='cf000000-0000-0000-0000-0000000000a1'),
  '2: class capacity and colour are NULL by default');

-- ── CHECKs ──────────────────────────────────────────────────────────────────
SELECT throws_ok($$ UPDATE class_categories SET default_capacity = 0
                    WHERE id='ce000000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, '3: a category default_capacity of 0 is refused');
SELECT throws_ok($$ UPDATE classes SET capacity = 0 WHERE id='cf000000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, '4: a class capacity of 0 is refused');
SELECT throws_ok($$ UPDATE classes SET colour = '#ff0000' WHERE id='cf000000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, '5: a hex colour is refused — colour is a palette KEY');
SELECT throws_ok($$ UPDATE classes SET colour = 'Sky' WHERE id='cf000000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, '6: an upper-case key is refused (keys are lower-case)');

-- ── The business's admin may write all three ────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok($$ UPDATE class_categories SET default_capacity = 6
                   WHERE id='ce000000-0000-0000-0000-0000000000a1' $$,
  '7: admin sets the category default');
SELECT lives_ok($$ UPDATE classes SET capacity = 4, colour = 'sky'
                   WHERE id='cf000000-0000-0000-0000-0000000000a1' $$,
  '8: admin sets class capacity + colour in one statement');
SELECT is((SELECT capacity::int FROM classes WHERE id='cf000000-0000-0000-0000-0000000000a1'),
  4, '9: capacity written');
SELECT is((SELECT colour FROM classes WHERE id='cf000000-0000-0000-0000-0000000000a1'),
  'sky', '10: colour written');

-- ── The coach cannot (RLS filters the row; value unchanged) ─────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"cb000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
UPDATE classes SET capacity = 99, colour = 'rose' WHERE id='cf000000-0000-0000-0000-0000000000a1';
UPDATE class_categories SET default_capacity = 99 WHERE id='ce000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT is((SELECT capacity::int FROM classes WHERE id='cf000000-0000-0000-0000-0000000000a1'),
  4, '11: a coach''s write to capacity/colour changes nothing');

-- ── Another business's admin cannot either ──────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
UPDATE classes SET capacity = 99 WHERE id='cf000000-0000-0000-0000-0000000000a1';
UPDATE class_categories SET default_capacity = 99 WHERE id='ce000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT ok((SELECT capacity = 4 FROM classes WHERE id='cf000000-0000-0000-0000-0000000000a1')
      AND (SELECT default_capacity = 6 FROM class_categories WHERE id='ce000000-0000-0000-0000-0000000000a1'),
  '12: another business''s admin changes nothing');

SELECT * FROM finish();
ROLLBACK;
