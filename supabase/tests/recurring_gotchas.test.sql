-- pgTAP: two schema traps that were each filed as a gotcha TWICE.
--
-- WHY THIS FILE EXISTS. docs/GOTCHAS.md is 340 KB and is read on demand, not in
-- full — so a trap that bites again gets re-discovered and re-filed instead of
-- recognised. Both of these were: §7.90 and §7.176 are the same lesson, and so
-- are §7.38, §7.104 and §7.156. A second filing is the signal that a note is
-- not working. These assertions fire at the moment the mistake is made, and
-- nobody has to have read anything. Both scan the catalog, not a named list, so
-- an object added next month is covered the day it is created.
--
-- PROVEN RED (§7.25), 2026-09-25: assertion 1 against an added second FK
-- between two tables; assertion 2 against a SECURITY DEFINER function
-- comparing `current_user = 'authenticated'` beneath a comment (the strip
-- works); assertion 3 against a listed pair that has only one FK.

BEGIN;
SELECT plan(3);

-- The unordered table pairs joined by more than one foreign key. Direction does
-- not matter: tenants.owner_profile_id -> profiles made profiles.tenant_id ->
-- tenants ambiguous (§7.90). Self-references are not a PostgREST embed pair.
CREATE TEMP TABLE _ambiguous_pairs ON COMMIT DROP AS
SELECT least(src.relname, dst.relname) || '|' || greatest(src.relname, dst.relname) AS pair
  FROM pg_constraint c
  JOIN pg_class src ON src.oid = c.conrelid
  JOIN pg_class dst ON dst.oid = c.confrelid
  JOIN pg_namespace sn ON sn.oid = src.relnamespace
  JOIN pg_namespace dn ON dn.oid = dst.relnamespace
 WHERE c.contype = 'f'
   AND sn.nspname = 'public' AND dn.nspname = 'public'
   AND c.conrelid <> c.confrelid
 GROUP BY 1
HAVING count(*) > 1;

-- Every pair here has had its embeds qualified as `table!column(...)`. A pair
-- is added to this list only AFTER that sweep — never to turn this test green.
CREATE TEMP TABLE _known_pairs (pair text) ON COMMIT DROP;
INSERT INTO _known_pairs VALUES
  ('attendance|profiles'),
  ('class_categories|package_products'),
  ('class_shadow_coaches|profiles'),
  ('classes|makeup_bookings'),
  ('credit_applications|invoices'),
  ('credit_applications|profiles'),
  ('credit_notes|invoices'),
  ('makeup_bookings|profiles'),
  ('package_products|tenants'),
  ('parent_packages|profiles'),
  ('parent_packages|referral_rewards'),
  ('parents|referrals'),
  ('profiles|referral_rewards'),
  ('profiles|student_settlements'),
  ('profiles|tenants'),
  ('profiles|trial_bookings');

-- ── 1. A NEW SECOND FOREIGN KEY (§7.90, §7.176) ──────────────────────────────
-- A second FK between two tables makes every BARE PostgREST embed between them
-- ambiguous. PostgREST then refuses the WHOLE query (PGRST201), and a `?? []`
-- renders that as an empty list. Nothing fails at migration time.
-- If this names a pair: grep both apps for embeds between the two tables,
-- qualify each one by column (`tenants!tenant_id(...)`), THEN add the pair above.
SELECT is(
  (SELECT COALESCE(string_agg(pair, ', ' ORDER BY pair), '')
     FROM _ambiguous_pairs WHERE pair NOT IN (SELECT pair FROM _known_pairs)),
  '',
  'no NEW table pair is joined by two foreign keys (qualify its embeds, then allowlist it — §7.90)');

-- ── 2. current_user INSIDE A SECURITY DEFINER FUNCTION (§7.38, §7.104, §7.156) ─
-- Inside a DEFINER function current_user is the OWNER (postgres), so a check on
-- it never tells a client from the service path, and fails OPEN. Authorise with
-- auth.uid() / can_admin_tenant() / current_parent_id(), or move the role check
-- into a separate plain (invoker) trigger. Comments are stripped first: three
-- DEFINER bodies carry warnings that name current_user.
SELECT is(
  (SELECT COALESCE(string_agg(p.proname, ', ' ORDER BY p.proname), '')
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND regexp_replace(
            regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'),
            '--[^\n]*', '', 'g') ~* '\mcurrent_user\M'),
  '',
  'no SECURITY DEFINER function reads current_user (it is always the owner — §7.38)');

-- ── 3. THE ALLOWLIST IS NOT STALE ────────────────────────────────────────────
-- A pair that is no longer ambiguous must leave the list, or a later FK on it
-- would be waved through without the embed sweep.
SELECT is(
  (SELECT COALESCE(string_agg(pair, ', ' ORDER BY pair), '')
     FROM _known_pairs WHERE pair NOT IN (SELECT pair FROM _ambiguous_pairs)),
  '',
  'every allowlisted pair is still joined by two foreign keys');

SELECT * FROM finish();
ROLLBACK;
