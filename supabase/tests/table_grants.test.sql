-- pgTAP: A CLIENT ROLE HOLDS A TABLE PRIVILEGE ONLY WHERE A POLICY COULD PERMIT IT.
--
-- The durable half of 20260804000600. That migration proves its own whitelist
-- once, at apply time; this file re-proves it on every CI run, which is what
-- makes the grant question answered rather than merely swept.
--
-- WHY THIS IS WRITTEN OVER THE CATALOGUE AND NOT AS A LIST OF TABLE NAMES.
-- Same reason as `function_grants.test.sql`: a named assertion cannot fail for
-- a table nobody thought to name. Written this way, a table added next month is
-- covered on the day it is created — and so is a policy added next month
-- without the grant to back it, which fails as assertion 1 rather than as a
-- support ticket.
--
-- ── WHY ONLY `authenticated` AND `anon` ──────────────────────────────────────
-- The invariant is FALSE for the other two roles, and writing it over all roles
-- would make this file red against a correct database — which is how a test
-- gets disabled, at which point it protects nothing:
--   • `service_role` has `rolbypassrls = true`. RLS is not consulted for it at
--     all, so "no policy permits this" says nothing about whether it should
--     hold the privilege. Its grants ARE its whole gate, deliberately, and it
--     is reachable only with the secret key.
--   • `postgres` owns the tables. Ownership is not a grant and cannot be
--     reasoned about this way.
-- Those two are out of scope by argument, not by oversight.
--
-- ── WHAT ASSERTION 2 IS ACTUALLY FOR ────────────────────────────────────────
-- 20260804000600 leaves a standing cost: a migration that adds a policy must
-- now also add the matching GRANT, or the app throws `permission denied` in
-- development. The tempting shortcut under deadline is a blanket re-grant —
-- `GRANT ALL ON ALL TABLES … TO authenticated` — which would restore exactly
-- the state that migration removed. Assertion 2 is what turns that shortcut
-- red: a blanket grant confers privileges no policy permits. The workaround
-- fails; it is not merely discouraged. (§7.87)
--
-- PROVEN RED. Applying `supabase/rollback/20260804_authenticated_grants_DOWN.sql`
-- to a migrated database — i.e. restoring the exact pre-000600 state — takes
-- this file to 3 of 5 failing (§7.25): assertion 2 names all 37 tables' surplus
-- privileges, 3 names the TRUNCATE/REFERENCES/TRIGGER holdings, and 5 names the
-- restored default-privilege row. 1 and 4 pass in both states, which is correct:
-- the whitelist is a superset restore, and `anon` is not touched by that file.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

-- ── 1. NOTHING MISSING ───────────────────────────────────────────────────────
-- A policy that permits a command, with no grant behind it, is an outage
-- waiting for the first user to reach that screen. This is the direction that
-- protects the product rather than the data.
SELECT is(
  (SELECT COALESCE(string_agg(relname || ':' || cmd, ', ' ORDER BY relname, cmd), '')
     FROM (
       SELECT c.relname, x.cmd
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) AS x(cmd)
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM pg_policies p
                       WHERE p.schemaname = 'public' AND p.tablename = c.relname
                         AND (p.cmd = x.cmd OR p.cmd = 'ALL')
                         AND ('authenticated' = ANY(p.roles) OR 'public' = ANY(p.roles)))
          AND NOT has_table_privilege('authenticated', c.oid, x.cmd)
     ) q),
  '',
  'every command a policy permits is backed by a grant to authenticated');

-- ── 2. NOTHING EXTRA ─────────────────────────────────────────────────────────
-- The other direction, and the one that makes a blanket re-grant fail.
SELECT is(
  (SELECT COALESCE(string_agg(relname || ':' || cmd, ', ' ORDER BY relname, cmd), '')
     FROM (
       SELECT c.relname, x.cmd
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                           ('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS x(cmd)
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND has_table_privilege('authenticated', c.oid, x.cmd)
          AND NOT EXISTS (SELECT 1 FROM pg_policies p
                           WHERE p.schemaname = 'public' AND p.tablename = c.relname
                             AND (p.cmd = x.cmd OR p.cmd = 'ALL')
                             AND ('authenticated' = ANY(p.roles) OR 'public' = ANY(p.roles)))
     ) q),
  '',
  'authenticated holds no table privilege that no policy could permit');

-- ── 3. THE THREE THAT RLS CANNOT SEE ─────────────────────────────────────────
-- Named separately from assertion 2 even though it subsumes them, because
-- TRUNCATE is the one where the consequence is not "reads a row it shouldn't"
-- but "the table is empty". No policy in this repo restrains TRUNCATE — RLS
-- does not apply to it — so the grant is the only gate there is.
SELECT is(
  (SELECT COALESCE(string_agg(c.relname || ':' || x.cmd, ', ' ORDER BY c.relname, x.cmd), '')
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS x(cmd)
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND has_table_privilege('authenticated', c.oid, x.cmd)),
  '',
  'authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any table');

-- ── 4. `anon` STILL HOLDS NOTHING ────────────────────────────────────────────
-- Regression pin for 20260804000400. `anon` is the unauthenticated role; it was
-- never granted DML by any migration and holds none now.
SELECT is(
  (SELECT COALESCE(string_agg(c.relname || ':' || x.cmd, ', ' ORDER BY c.relname, x.cmd), '')
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                       ('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS x(cmd)
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND has_table_privilege('anon', c.oid, x.cmd)),
  '',
  'anon holds no privilege on any table in public');

-- ── 5. THE DEFAULT-PRIVILEGE ROWS STAY SHUT ──────────────────────────────────
-- Assertions 1–4 describe the tables that exist now. This one is why they stay
-- true: with the default rows closed, a table created next month is born with
-- no client grant at all, so the failure mode for a forgotten GRANT is a loud
-- `permission denied` in development rather than a silent hole.
--
-- Only the rows owned by `postgres` are checked. The `supabase_admin` defaults
-- also name these roles and are deliberately left alone — nothing in this repo
-- creates objects as `supabase_admin`, and on cloud `postgres` may not hold the
-- membership needed to change them (20260804000400).
SELECT is(
  (SELECT COALESCE(string_agg(DISTINCT defaclobjtype::text, ', '), '')
     FROM pg_default_acl
    WHERE pg_get_userbyid(defaclrole) = 'postgres'
      AND defaclnamespace = 'public'::regnamespace
      AND (defaclacl::text LIKE '%authenticated=%' OR defaclacl::text LIKE '%anon=%')),
  '',
  'no postgres-owned default privilege in public grants anon or authenticated');

-- ── 6. NOTHING IN `public` IS OUTSIDE THE INVARIANT'S REACH ─────────────────
-- Assertions 1–3 reason over `relkind='r'` and over TABLE-level privileges.
-- Two things sit outside that and would make them quietly incomplete rather
-- than loudly wrong, which is worse:
--   • a view / matview / partitioned / foreign table — no policies to derive
--     from, but `REVOKE ON ALL TABLES` still reaches it;
--   • a column-level grant — `has_table_privilege()` cannot see one, and a
--     table-level REVOKE does not remove it.
-- Neither exists today. This assertion is what makes that a checked fact rather
-- than a comment that ages.
--
-- TWO SOURCES THAT LOOK RIGHT AND ARE NOT, both found by mutation-testing this
-- assertion rather than by reading it:
--   • `information_schema.column_privileges` expands TABLE-level grants per
--     column (708 rows here). Using it would make this permanently red.
--   • **`pg_class` alone includes the pgTAP extension's own views.**
--     `CREATE EXTENSION pgtap` above installs `pg_all_foreign_keys` and
--     `tap_funky` into `public`, so without the `pg_depend deptype='e'` filter
--     this assertion fails on a perfectly correct database — inside the very
--     harness that runs it. A test that is red when nothing is wrong gets
--     disabled, and then it protects nothing.
SELECT is(
  (SELECT COALESCE(
     (SELECT string_agg(c.relname || '(' || c.relkind::text || ')', ', ' ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('v','m','p','f')
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.objid = c.oid AND d.deptype = 'e')), '')
   || COALESCE(
     (SELECT string_agg(' col:' || c.relname || '.' || a.attname, ', ')
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
         AND (a.attacl::text LIKE '%authenticated=%' OR a.attacl::text LIKE '%anon=%')), '')),
  '',
  'no view, partition, foreign table or column-level grant escapes the invariant');

SELECT * FROM finish();
ROLLBACK;
