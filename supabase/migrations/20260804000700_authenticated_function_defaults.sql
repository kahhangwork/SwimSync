-- ============================================================
-- THE LAST DEFAULT-PRIVILEGE ROW: NEW FUNCTIONS STILL REACHED `authenticated`.
--
-- Found by dumping production immediately after 20260804000600 landed — i.e. by
-- the §11.7 check, not by reading the migration back. Every other default was
-- shut; this one survived three migrations because each closed a different
-- corner of the same mechanism:
--
--   20260804000400  functions  ← anon, and PUBLIC (globally)     [not authenticated]
--   20260804000600  tables, sequences ← authenticated            [not functions]
--   this file       functions  ← authenticated
--
-- Production still carried, owned by the role that runs migrations:
--   ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
--     GRANT ALL ON FUNCTIONS TO "authenticated";
--
-- ── WHY THIS WAS THE DANGEROUS DIRECTION OF THE §7.39 SPLIT ──────────────────
-- The LOCAL stack has no such row. So a function added by a future migration
-- would have been:
--   • locally  — callable by nobody, failing loudly the first time the app
--     called it, exactly as 20260804000400's header promises; and
--   • on cloud — silently EXECUTE-able by every signed-in user, without its
--     migration ever saying so.
-- The loud half would have been "fixed" in development by adding the grant the
-- developer meant; the silent half would have kept whatever else the function
-- exposed. That is the shape of §7.82 (`next_credit_note_ref`: a helper nobody
-- intended to expose, auto-granted, reachable as a PostgREST RPC) with
-- `authenticated` in place of `anon` — a smaller blast radius, because the
-- caller must at least hold an account, and signup is open, so not much smaller.
--
-- ── NOTHING IS OVER-GRANTED TODAY; THIS IS THE TAP, NOT A SPILL ──────────────
-- Measured before writing this, by diffing the remote dump against local:
-- production grants EXECUTE to `authenticated` on 79 functions in `public`,
-- local on 78, and the single difference is `rls_auto_enable` — production's
-- EVENT TRIGGER function, which Postgres never privilege-checks and PostgREST
-- does not expose (the same known local/cloud gap `function_grants.test.sql`
-- names). So the 78 real ones came from explicit `GRANT` statements in this
-- repo's migrations, not from the default. No existing function needs revoking,
-- and this migration deliberately revokes none — `authenticated` executing the
-- product's RPCs is the product working.
--
-- ── WHAT THIS COSTS, AND WHY IT IS THE SAFE DIRECTION ────────────────────────
-- After this, production matches local: a new function is callable by NOBODY
-- until its own migration grants it. Every callable function in this repo
-- already carries an explicit grant, so nothing existing changes — and since
-- local was already the stricter of the two, any migration that would break
-- under this rule was already broken in development. This REDUCES the
-- local/cloud divergence rather than adding to it, which is why it is safe to
-- do in the same session that discovered it.
--
--   `service_role` is untouched, as in 000600. It bypasses RLS by design and
--   the edge functions depend on it; that is a separate decision.
--   The `supabase_admin`-owned default rows are also left alone — nothing here
--   creates objects as `supabase_admin`, and on cloud `postgres` may not hold
--   the membership needed to change them (20260804000400).
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM authenticated;

-- ── Prove it where it actually matters ───────────────────────────────────────
-- This probe passes on LOCAL by construction — the row it removes was never
-- there — so a green local run is not evidence. The meaningful execution is
-- against production during `db push`, where a RAISE aborts the migration.
-- 20260804000600's probe covered tables and sequences and did NOT cover
-- functions, which is why this gap survived it; the probe below is the
-- correction as much as the statement above is.
DO $probe$
DECLARE
  v_leaked BOOLEAN;
BEGIN
  EXECUTE 'CREATE FUNCTION public.__auth_fn_default_probe() RETURNS INT '
          'LANGUAGE sql IMMUTABLE AS $f$ SELECT 1 $f$';
  v_leaked := has_function_privilege('authenticated',
                                     'public.__auth_fn_default_probe()', 'EXECUTE');
  EXECUTE 'DROP FUNCTION public.__auth_fn_default_probe()';
  IF v_leaked THEN
    RAISE EXCEPTION
      'default privileges still grant authenticated EXECUTE on new functions — '
      'check WHICH ROLE owns the pg_default_acl row (this file targets '
      '`postgres`; a row owned by `supabase_admin` cannot be revoked from here).';
  END IF;

  -- And the same question asked of anon, so this file also re-pins 000400 on
  -- whatever database it runs against.
  EXECUTE 'CREATE FUNCTION public.__anon_fn_default_probe() RETURNS INT '
          'LANGUAGE sql IMMUTABLE AS $f$ SELECT 1 $f$';
  v_leaked := has_function_privilege('anon',
                                     'public.__anon_fn_default_probe()', 'EXECUTE');
  EXECUTE 'DROP FUNCTION public.__anon_fn_default_probe()';
  IF v_leaked THEN
    RAISE EXCEPTION 'default privileges still grant anon EXECUTE on new functions.';
  END IF;

  RAISE NOTICE 'function default privileges closed for both client roles.';
END
$probe$;
