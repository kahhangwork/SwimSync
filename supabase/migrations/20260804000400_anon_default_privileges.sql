-- ============================================================
-- STOP HANDING `anon` A KEY TO EVERY NEW OBJECT.
--
-- 20260804000200 revoked EXECUTE from every function `anon` could reach. That was
-- a POINT-IN-TIME sweep: the mechanism that granted them was left running, so the
-- count climbs back on its own as functions are created. This turns the mechanism
-- off, and sweeps the two object types 000200 did not cover.
--
-- ── WHAT THE MECHANISM ACTUALLY IS ───────────────────────────────────────────
-- Not "the Supabase image's template" in the hand-wavy sense §7.82 and BACKLOG
-- first described. It is four rows in `pg_default_acl`, visible in any remote
-- dump, attached to the role that RUNS MIGRATIONS:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO anon;      -- and TABLES, and SEQUENCES
--
-- Because they are attached to `postgres`, and migrations run as `postgres`,
-- every object this repo has ever created was born with an `anon` grant on
-- production. That is also why they are revocable BY us: had they been attached
-- to `supabase_admin`, the statements below would be a silent no-op.
--
--   THE `supabase_admin` DEFAULTS ARE LEFT ALONE, and they still name `anon`.
--   Nothing in this repo creates objects as `supabase_admin`, and on cloud
--   `postgres` is not a superuser and may not hold the membership needed to
--   change them. If an object ever appears with an `anon` grant that this
--   migration should have prevented, check WHO created it before assuming this
--   file failed.
--
-- ── WHY THIS IS NOW SAFE, WHEN IT WAS REFUSED IN JULY ────────────────────────
-- Declined 2026-07-21 during the tenant-provisioning deploy on the grounds that
-- it changes every FUTURE function's ACL, "including PostgREST-facing ones that
-- may legitimately need anon". That objection expired on 2026-08-02: building
-- the public invoice page established the standing rule in
-- `docs/ARCHITECTURE.md` §6 — **anything public and sessionless is served by an
-- EDGE FUNCTION, never an anon RPC** — precisely so that schema-level access for
-- `anon` never has to be opened. The case this would block is one the
-- architecture already forbids, so it stops being a constraint on a future
-- choice and becomes enforcement of a decision already made.
--
-- WHAT IT DOES NOT DO: it does not make the remote grant dump obsolete
-- (`docs/DEPLOYMENT.md` §11.7). It closes the AUTOMATIC leak. A migration that
-- explicitly writes `GRANT … TO anon` still grants, as it should.
--
-- FUNCTIONS THAT ALREADY EXIST are not touched here — 000200 did that, and its
-- deliberate exception stands: the 18 trigger / event-trigger functions keep
-- their grant because Postgres never privilege-checks a trigger function against
-- the writing role and PostgREST does not expose one. Nothing has changed to
-- make that reasoning wrong, so it is not being reopened in the same week.
--
-- ── VERIFICATION IS BUILT IN, BECAUSE LOCAL CANNOT SEE THE IMPORTANT HALF ────
-- Local and production disagree, which is the whole §7.39 problem:
--
--   object type   local `postgres` default   production `postgres` default
--   FUNCTIONS     anon ABSENT                anon PRESENT   ← the leak
--   TABLES        anon = Dxtm                anon = Dxtm
--   SEQUENCES     anon = w                   anon = rwU
--
-- So a green local run proves the table and sequence halves and proves NOTHING
-- about the function half. Rather than leave that to a checklist, the probes at
-- the bottom CREATE a throwaway object of each type, ask whether `anon` can
-- reach it, drop it, and RAISE if the answer is yes. They run wherever this
-- migration runs — including against production during `db push`, which is the
-- only place the function answer is meaningful.
-- ============================================================

-- ── 1. Turn the mechanism off, for objects created from here on ───────────────
--
-- TWO SEPARATE MECHANISMS GRANT `anon` A NEW FUNCTION, and revoking one leaves
-- the other. Caught by mutation-testing the probe below: with only the
-- `FROM anon` line present, a freshly created function was STILL anon-executable.
--
--   (a) the pg_default_acl row described above — cloud only; and
--   (b) Postgres' own built-in rule that a new function is EXECUTE **TO PUBLIC**,
--       and `anon` is a member of PUBLIC. This one is universal — it is why
--       `next_credit_note_ref` was reachable on the LOCAL stack too (§7.82), and
--       no amount of revoking "from anon" touches it.
--
-- **AND (b) CANNOT BE REVOKED PER-SCHEMA.** `… IN SCHEMA public REVOKE EXECUTE
-- ON FUNCTIONS FROM PUBLIC` runs without error, reports success, and does
-- NOTHING: the built-in PUBLIC grant is global, so a schema-scoped entry has no
-- PUBLIC in it to remove. Measured on the local stack (§7.85):
--
--   IN SCHEMA public REVOKE … FROM PUBLIC  → default row unchanged,
--                                            new function anon_can = TRUE
--   (global) REVOKE … FROM PUBLIC          → new row `(global)={postgres=X/postgres}`,
--                                            new function anon_can = FALSE
--
-- So the line below deliberately omits `IN SCHEMA`. It is scoped by ROLE
-- instead: `FOR ROLE postgres` reaches only what this repo's migrations create.
-- Extension functions are unaffected — they are created by `supabase_admin` in
-- the `extensions` schema, which carries its own default-ACL row.
--
--   CONSEQUENCE FOR EVERY FUTURE MIGRATION, and it is deliberate: a new function
--   is now callable by NOBODY until its migration says otherwise. A forgotten
--   `GRANT EXECUTE … TO authenticated` becomes a loud "permission denied for
--   function" the first time the app calls it — in development — instead of a
--   silent hole that only a remote grant dump would ever have found. Every
--   callable function in this repo already carries an explicit grant, so nothing
--   existing changes; only the failure mode for new ones does.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

-- ── 2. Sweep what the mechanism already produced ──────────────────────────────
-- Tables: `anon` holds REFERENCES / TRIGGER / TRUNCATE / MAINTAIN on all 37 —
-- never SELECT or any DML, which 20260309000800 deliberately never granted.
-- **TRUNCATE is the one that matters: RLS does not restrict it**, so no policy
-- in this repo covers it. It has never been reachable — `anon` has
-- `rolcanlogin = false`, so the only route in is PostgREST, which has no
-- TRUNCATE verb and no DDL — which is why this was filed rather than rushed.
-- Removing it costs nothing: nothing anywhere reads these privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Sequences: `credit_note_seq` is the only one, and `anon` holds ALL on it in
-- production (USAGE included, i.e. `nextval()`). Also unreachable — PostgREST
-- exposes no sequence verb — and, separately, the sequence appears to be
-- vestigial: `next_credit_note_ref()` numbers credit notes from
-- `tenants.credit_note_counter`, not from here. Left in place rather than
-- dropped, because "appears to be" is not "is" and dropping it is a different
-- decision from revoking a grant nobody uses.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ── 3. Prove it, here, on whatever database this is being applied to ──────────
DO $probe$
DECLARE
  v_leaked BOOLEAN;
BEGIN
  -- FUNCTIONS. The half that local cannot answer and production can.
  EXECUTE 'CREATE FUNCTION public.__anon_default_probe() RETURNS INT '
          'LANGUAGE sql IMMUTABLE AS $f$ SELECT 1 $f$';
  v_leaked := has_function_privilege('anon', 'public.__anon_default_probe()', 'EXECUTE');
  EXECUTE 'DROP FUNCTION public.__anon_default_probe()';
  IF v_leaked THEN
    RAISE EXCEPTION
      'default privileges still grant anon EXECUTE on new functions. The '
      'ALTER DEFAULT PRIVILEGES above did not take — check WHICH ROLE owns the '
      'pg_default_acl row (this file targets `postgres`; a row owned by '
      '`supabase_admin` cannot be revoked from here).';
  END IF;

  -- TABLES. TRUNCATE specifically, because RLS does not restrain it.
  EXECUTE 'CREATE TABLE public.__anon_default_probe (id INT)';
  v_leaked := has_table_privilege('anon', 'public.__anon_default_probe', 'TRUNCATE')
           OR has_table_privilege('anon', 'public.__anon_default_probe', 'SELECT');
  EXECUTE 'DROP TABLE public.__anon_default_probe';
  IF v_leaked THEN
    RAISE EXCEPTION 'default privileges still reach anon on new tables.';
  END IF;

  -- SEQUENCES.
  EXECUTE 'CREATE SEQUENCE public.__anon_default_probe_seq';
  v_leaked := has_sequence_privilege('anon', 'public.__anon_default_probe_seq', 'USAGE')
           OR has_sequence_privilege('anon', 'public.__anon_default_probe_seq', 'UPDATE');
  EXECUTE 'DROP SEQUENCE public.__anon_default_probe_seq';
  IF v_leaked THEN
    RAISE EXCEPTION 'default privileges still reach anon on new sequences.';
  END IF;

  RAISE NOTICE 'anon default-privilege probes clean: functions, tables, sequences.';
END
$probe$;
