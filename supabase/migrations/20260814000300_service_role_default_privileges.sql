-- ============================================================
-- STOP HANDING `service_role` A KEY TO EVERY NEW OBJECT.
--
-- This is the sibling of 20260804000400, which turned the same mechanism off for
-- `anon` and PUBLIC. `service_role` was left running that day, deliberately and
-- on the record, pending a decision: is `service_role` worth a usage whitelist?
-- The audit answered it (BACKLOG.md → *Decide whether `service_role` deserves the
-- whitelist treatment*, 11 call sites read from the code, 2026-08-10):
-- **do NOT build the whitelist — close the default instead.** This file is that.
--
-- ── WHY `service_role` IS THE ROLE WHERE GRANTS ARE THE ENTIRE GATE ──────────
-- `service_role` has `rolbypassrls = true`, so no policy in this repo restrains
-- it — unlike `authenticated`, whose access is gated by RLS and whose grants
-- 20260804000600 could therefore prove dead. For `service_role` the grant IS the
-- gate. Today it holds `arwdDxtm` on all 37 tables plus EXECUTE on everything.
-- Its one protection is the KEY: `service_role` is reachable only with the secret,
-- held by the edge functions and the admin panel's server routes, never shipped
-- to a browser.
--
-- ── WHAT THE MECHANISM IS (same rows, different grantee) ─────────────────────
-- The pg_default_acl rows attached to `postgres` — the role migrations run as —
-- also name `service_role`:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON FUNCTIONS  TO service_role;   -- and TABLES, and SEQUENCES
--
-- So every object this repo has ever created was born granting `service_role`
-- full access on production, and every future one would be too. This turns that
-- automatic grant off, for objects created from here on.
--
--   THE PUBLIC / built-in function grant is NOT re-revoked here. 20260804000400
--   already ran `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON
--   FUNCTIONS FROM PUBLIC` (global, not schema-scoped — see that file for why the
--   `IN SCHEMA` form is a silent no-op). PUBLIC no longer grants EXECUTE on new
--   functions to anyone, `service_role` included, so the only remaining leak for
--   `service_role` is its own default-ACL row, which is what the three statements
--   below close.
--
-- ── WHAT THIS DELIBERATELY DOES **NOT** DO ───────────────────────────────────
-- It does NOT sweep the 37 existing tables. `anon`'s file (section 2) revoked the
-- REFERENCES/TRIGGER/TRUNCATE grants it had leaked, because nothing read them.
-- Here the opposite is true: `generate-invoices` alone reads 21 of the 37 tables
-- and writes 8, through `service_role`, and every one of the ~dozen a whitelist
-- would exclude is a table a future feature plausibly reaches from the engine or
-- an admin route. Revoking an existing `service_role` grant risks `permission
-- denied` INSIDE THE INVOICE ENGINE — the one thing in this repo that must never
-- fail silently. So this closes the automatic leak for FUTURE objects only; the
-- existing 37 keep their grants, and that is correct.
--
-- It does NOT defend against the actual worst case, and does not pretend to: a
-- leaked secret key also holds `auth.admin.deleteUser` / `updateUserById`. Those
-- are not table grants and no GRANT/REVOKE can restrain them. This narrows the
-- blast radius on future tables; nothing more.
--
-- It does NOT make the remote grant dump obsolete (`docs/DEPLOYMENT.md` §11.7).
-- A migration that explicitly writes `GRANT … TO service_role` still grants, as
-- it should.
--
-- ── VERIFICATION IS BUILT IN, BECAUSE LOCAL CANNOT SEE THE IMPORTANT HALF ─────
-- Same §7.39 split as 20260804000400: local `postgres` defaults and cloud
-- `postgres` defaults disagree, and the FUNCTIONS half is exactly where they do.
-- A green LOCAL run proves the table/sequence halves and proves NOTHING about the
-- function half — the meaningful answer comes only when this runs against
-- production during `db push`. The probes at the bottom create a throwaway object
-- of each type, ask whether `service_role` can still reach it, drop it, and RAISE
-- if the answer is yes. They run wherever this migration runs.
-- ============================================================

-- ── 1. Turn the mechanism off, for objects created from here on ───────────────
-- Scoped by ROLE (`FOR ROLE postgres`) so it reaches only what this repo's
-- migrations create; extension objects, created by `supabase_admin` in their own
-- schemas, carry their own default-ACL rows and are untouched.
--
-- CONSEQUENCE FOR EVERY FUTURE MIGRATION, and it is deliberate: a new table,
-- function, or sequence is now reachable by `service_role` only where its own
-- migration says `GRANT … TO service_role`. Because the edge functions and admin
-- routes run as `service_role`, a forgotten grant on a table a NEW feature needs
-- becomes a loud `permission denied` the first time that code path runs — in
-- development — instead of a silent reliance on the blanket default. Everything
-- that exists today keeps its grant (section above); only the failure mode for
-- new objects changes.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM service_role;

-- ── 2. (No existing-object sweep — see the header. Intentionally absent.) ──────

-- ── 3. Prove it, here, on whatever database this is being applied to ──────────
DO $probe$
DECLARE
  v_leaked BOOLEAN;
BEGIN
  -- FUNCTIONS. The half that local cannot answer and production can.
  EXECUTE 'CREATE FUNCTION public.__srv_default_probe() RETURNS INT '
          'LANGUAGE sql IMMUTABLE AS $f$ SELECT 1 $f$';
  v_leaked := has_function_privilege('service_role', 'public.__srv_default_probe()', 'EXECUTE');
  EXECUTE 'DROP FUNCTION public.__srv_default_probe()';
  IF v_leaked THEN
    RAISE EXCEPTION
      'default privileges still grant service_role EXECUTE on new functions. The '
      'ALTER DEFAULT PRIVILEGES above did not take — check WHICH ROLE owns the '
      'pg_default_acl row (this file targets `postgres`; a row owned by '
      '`supabase_admin` cannot be revoked from here).';
  END IF;

  -- TABLES. A new table must grant service_role nothing once the default is off.
  EXECUTE 'CREATE TABLE public.__srv_default_probe (id INT)';
  v_leaked := has_table_privilege('service_role', 'public.__srv_default_probe', 'SELECT')
           OR has_table_privilege('service_role', 'public.__srv_default_probe', 'INSERT')
           OR has_table_privilege('service_role', 'public.__srv_default_probe', 'TRUNCATE');
  EXECUTE 'DROP TABLE public.__srv_default_probe';
  IF v_leaked THEN
    RAISE EXCEPTION 'default privileges still reach service_role on new tables.';
  END IF;

  -- SEQUENCES.
  EXECUTE 'CREATE SEQUENCE public.__srv_default_probe_seq';
  v_leaked := has_sequence_privilege('service_role', 'public.__srv_default_probe_seq', 'USAGE')
           OR has_sequence_privilege('service_role', 'public.__srv_default_probe_seq', 'UPDATE');
  EXECUTE 'DROP SEQUENCE public.__srv_default_probe_seq';
  IF v_leaked THEN
    RAISE EXCEPTION 'default privileges still reach service_role on new sequences.';
  END IF;

  RAISE NOTICE 'service_role default-privilege probes clean: functions, tables, sequences.';
END
$probe$;
