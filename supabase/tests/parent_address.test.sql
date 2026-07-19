-- pgTAP: a parent may maintain their own address, and nothing else.
--
-- parents_update was is_platform_admin() only, so this is NEW write surface on
-- a table a family owns. What it must not become is a way to reach another
-- family's row, or to rewrite the column that decides whose row it is.
--
-- Its own users, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

SELECT has_column('public','parents','address',     'parents.address exists');
SELECT has_column('public','parents','postal_code', 'parents.postal_code exists');

-- TEXT, not an integer: Singapore postal codes have significant leading zeros.
-- Storing them numerically turns "018956" into 18956, which is a different
-- place and unrecoverable once written.
SELECT col_type_is('public','parents','postal_code','text',
  'postal_code is TEXT — an integer would eat the leading zero');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7f000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','addr-one@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"Addr One","role":"parent"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7f000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','addr-two@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"Addr Two","role":"parent"}', now(), now(), '','','','');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7f000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok($$
  UPDATE parents SET address = 'Blk 1 Test Ave', postal_code = '018956'
   WHERE profile_id = '7f000000-0000-0000-0000-000000000001'
$$, 'a parent can set their own address');

SELECT is(
  (SELECT postal_code FROM parents WHERE profile_id='7f000000-0000-0000-0000-000000000001'),
  '018956',
  'the leading zero survives the round trip');

-- A 5-digit or alphabetic code is a typo, and a typo in the one field the
-- coach filters on is worse than an empty field.
SELECT throws_ok($$
  UPDATE parents SET postal_code = '12345'
   WHERE profile_id = '7f000000-0000-0000-0000-000000000001'
$$, '23514', NULL,
  'a malformed postal code is rejected');

-- The new policy is scoped to the caller's own row. RLS makes another family's
-- row invisible rather than erroring, so assert on the ROW not changing.
UPDATE parents SET address = 'Someone Else''s House'
 WHERE profile_id = '7f000000-0000-0000-0000-000000000002';

SELECT is(
  (SELECT address FROM parents WHERE profile_id='7f000000-0000-0000-0000-000000000002'),
  NULL,
  'a parent cannot write ANOTHER family''s address');

-- profile_id decides whose row this is, so a client able to rewrite it could
-- reassign the record to someone else.
SELECT throws_ok($$
  UPDATE parents SET profile_id = '7f000000-0000-0000-0000-000000000002'
   WHERE profile_id = '7f000000-0000-0000-0000-000000000001'
$$, '23514', NULL,
  'a parent cannot reassign their record to another profile');

SELECT * FROM finish();
ROLLBACK;
