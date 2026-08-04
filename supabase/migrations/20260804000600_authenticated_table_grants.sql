-- ============================================================
-- `authenticated` HOLDS A TABLE PRIVILEGE ONLY WHERE A POLICY COULD PERMIT IT.
--
-- The answer to the question 20260804000200/000400 left open in HANDOVER §9:
-- does `authenticated` deserve the sweep `anon` got? **Not the same sweep**, and
-- the difference is structural rather than a matter of degree:
--
--   • `anon` had no load-bearing grants at all, so revoking was free.
--   • `authenticated` IS the app. Parent, coach and tenant admin are all the
--     same database role, so a grant cannot tell them apart. `invoices` must be
--     SELECT-able by `authenticated` for the product to work; only RLS has the
--     resolution to stop one parent reading another's. Blanket-revoking here
--     does not harden the product, it breaks it.
--
-- So this migration does the part that IS free, and states plainly what it does
-- not buy. Measured on 2026-08-04, before this ran:
--
--   • `authenticated` held all 7 privileges on all 37 tables — the blanket
--     default, not anything a migration wrote. The remote dump agreed exactly:
--     `GRANT ALL ON TABLE "public"."<t>" TO "authenticated";` × 37.
--   • **50 of the 148 (table × command) pairs had no policy that could ever
--     permit them** — `invoices` INSERT/DELETE, `credit_notes` all three
--     writes, `billing_periods` all three, and so on. RLS denies those already;
--     the grant was decoration.
--   • TRUNCATE, REFERENCES and TRIGGER on all 37 were pure surplus. TRUNCATE is
--     the one worth naming: **RLS does not restrain it**, so no policy in this
--     repo covers it. It has never been reachable — `authenticated` has
--     `rolcanlogin = false` and no CREATE on schema `public`, PostgREST has no
--     TRUNCATE verb and no DDL — which is why this was filed rather than
--     rushed. Removing it costs nothing; nothing reads these privileges.
--
-- ── WHY A WHITELIST AND NOT A LIST OF REVOKES ────────────────────────────────
-- Revoking the 50 dead pairs would leave the grant set a RESIDUE — whatever
-- happened to survive. Revoking everything and granting back what policies
-- justify makes it a DECLARED SET, which is the thing that can then be
-- re-proven on every CI run (`supabase/tests/table_grants.test.sql`). It also
-- converges local and production to an identical state in one statement, which
-- matters because §7.39 says they disagree by construction.
--
-- The whitelist below is DERIVED, not hand-written — for each table, the
-- commands for which a policy naming `authenticated` (or `public`, which
-- includes it) exists:
--
--   WITH t AS (SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--              WHERE n.nspname='public' AND c.relkind='r'),
--   cmds(cmd) AS (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'))
--   SELECT t.relname, string_agg(cmds.cmd, ', ')
--     FROM t CROSS JOIN cmds
--    WHERE EXISTS (SELECT 1 FROM pg_policies p
--                   WHERE p.schemaname='public' AND p.tablename=t.relname
--                     AND (p.cmd=cmds.cmd OR p.cmd='ALL')
--                     AND ('authenticated'=ANY(p.roles) OR 'public'=ANY(p.roles)))
--    GROUP BY t.relname ORDER BY t.relname;
--
-- Run it against BOTH databases before editing this file. On 2026-08-04 the
-- policy sets differed by exactly the two policies 20260804000500 drops, and
-- by nothing else.
--
--   THE ORDER MATTERED, and it is the non-obvious part. This migration is
--   derived FROM the policy set, so it grants whatever the policies say. Had it
--   run before 20260804000500, it would have blessed `parent_tenants:INSERT`
--   and `parent_students:INSERT` — the two forgery paths — into a *reviewed,
--   declared* whitelist, and the holes would have stopped looking like holes.
--   A whitelist inherits the judgement of what it is derived from. Fix the
--   policy first, always.
--
-- ── WHAT THIS DOES NOT BUY, said plainly so nobody over-reads it ─────────────
-- Nothing on the ~98 live pairs, which is where a real breach would come from.
-- A parent reading another family's invoice is stopped by `invoices_select`,
-- not by any grant. This migration closes the second line; the first line is
-- the policy set and its assertions.
--
-- `service_role` is deliberately untouched. It holds `arwdDxtm` and
-- `rolbypassrls = true`, so for IT the grants genuinely are the only gate — but
-- it is reachable only with the secret key and the edge functions depend on it.
-- That is a separate decision with a separate argument, not a rider on this one.
-- ============================================================

-- ── 1. Start from nothing ─────────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

-- ── 2. Grant back exactly what a policy could permit ──────────────────────────
GRANT SELECT, UPDATE                         ON public.app_settings             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.attendance               TO authenticated;
GRANT SELECT, INSERT                         ON public.audit_log                TO authenticated;
GRANT SELECT                                 ON public.billing_periods          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.class_categories         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.class_rate_overrides     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.class_rates              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.classes                  TO authenticated;
GRANT SELECT                                 ON public.coach_payout_items       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.coach_payouts            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.coach_rates              TO authenticated;
GRANT SELECT, UPDATE                         ON public.coaches                  TO authenticated;
GRANT SELECT                                 ON public.credit_applications      TO authenticated;
GRANT SELECT                                 ON public.credit_notes             TO authenticated;
GRANT SELECT                                 ON public.invoice_items            TO authenticated;
GRANT SELECT, UPDATE                         ON public.invoices                 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.lesson_sessions          TO authenticated;
GRANT SELECT, INSERT, UPDATE                 ON public.makeup_bookings          TO authenticated;
GRANT SELECT                                 ON public.package_applications     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.package_products         TO authenticated;
GRANT SELECT, INSERT, UPDATE                 ON public.parent_packages          TO authenticated;
-- No INSERT: 20260804000500 dropped parent_students_insert (forgery path).
-- DELETE stays — §7.47 records the parent's own unlink as a deliberate property
-- and warns specifically against changing it here.
GRANT SELECT, DELETE                         ON public.parent_students          TO authenticated;
GRANT SELECT                                 ON public.parent_tenant_balances   TO authenticated;
-- No INSERT: 20260804000500 dropped parent_tenants_insert. Joining a business
-- goes through join_tenant_by_code(), which is SECURITY DEFINER.
GRANT SELECT                                 ON public.parent_tenants           TO authenticated;
GRANT SELECT, UPDATE                         ON public.parents                  TO authenticated;
GRANT SELECT, INSERT                         ON public.payment_records          TO authenticated;
GRANT SELECT, UPDATE                         ON public.profiles                 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.session_pay_overrides    TO authenticated;
GRANT SELECT                                 ON public.student_claims           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.student_class_enrolments TO authenticated;
GRANT SELECT, INSERT, UPDATE                 ON public.student_settlements      TO authenticated;
GRANT SELECT, INSERT, UPDATE                 ON public.students                 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.tenant_level_skills      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.tenant_levels            TO authenticated;
GRANT SELECT, UPDATE                         ON public.tenants                  TO authenticated;
GRANT SELECT, INSERT, UPDATE                 ON public.trial_bookings           TO authenticated;
GRANT SELECT, INSERT                         ON public.trial_rates              TO authenticated;

-- ── 3. Turn off the mechanism, so this is not a point-in-time sweep ───────────
-- 20260804000400 did this for `anon` and left `authenticated` alone. The row it
-- left behind still reads
--   postgres | public | r | {postgres=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
-- where `D` is TRUNCATE — so every table a future migration creates was still
-- being born handing `authenticated` a truncate right.
--
--   DO NOT ADD AN `IN SCHEMA … REVOKE … FROM PUBLIC` LINE HERE. That is the
--   §7.85 trap, and it does not apply to tables: unlike functions, a new table
--   carries NO built-in PUBLIC grant, so there is nothing global to revoke.
--   The `FROM authenticated` form below is sufficient AND effective for tables,
--   which is exactly the opposite of the function case. Verified by the probe
--   in section 4, which creates a table and asks.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM authenticated;

-- ── 4. Prove the whitelist here, before this transaction commits ──────────────
-- Both directions. The "nothing missing" half is the one that matters at 3am:
-- it is what stops a typo'd GRANT from reaching real families, and because a
-- RAISE aborts the migration it fails on `db push` against PRODUCTION too,
-- not only in CI.
DO $probe$
DECLARE
  v_missing TEXT;
  v_extra   TEXT;
  v_views   TEXT;
  v_colacl  TEXT;
  v_leaked  BOOLEAN;
BEGIN
  -- (a) NOTHING MISSING. Every (table, command) a policy could permit must be
  --     granted. Named, not counted — a count says nothing about what to fix.
  SELECT string_agg(relname || ':' || cmd, ', ' ORDER BY relname, cmd)
    INTO v_missing
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
    ) q;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'whitelist is INCOMPLETE — a policy permits these but no grant backs them, '
      'so the app will fail with permission denied: %', v_missing;
  END IF;

  -- (b) NOTHING EXTRA. The invariant in the other direction, and the thing that
  --     makes a future blanket re-grant fail loudly instead of quietly.
  SELECT string_agg(relname || ':' || cmd, ', ' ORDER BY relname, cmd)
    INTO v_extra
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
    ) q;
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'authenticated holds privileges no policy could permit: %', v_extra;
  END IF;

  -- (c) THE relkind ASSUMPTION. `REVOKE … ON ALL TABLES` reaches views,
  --     materialised views, partitioned tables and foreign tables as well, but
  --     the whitelist derivation above only scans `relkind='r'` — anything else
  --     would be silently stripped of every grant and never granted back. A
  --     view additionally has no policies of its own, so there is nothing for
  --     the derivation to read even if it looked.
  --     `public` holds none of these today (checked on BOTH databases,
  --     2026-08-04), so this guards a latent trap rather than a live one: it
  --     fires on the day someone adds the first one, which is when the
  --     derivation must be extended — rather than on the day a grant quietly
  --     goes missing.
  --     EXTENSION-OWNED RELATIONS ARE EXCLUDED, and the omission is not
  --     theoretical: `CREATE EXTENSION pgtap` installs `pg_all_foreign_keys`
  --     and `tap_funky` as views in `public`, so without the `pg_depend`
  --     filter this fires on any database that has ever run the test suite.
  SELECT string_agg(c.relname || '(' || c.relkind::text || ')', ', ' ORDER BY c.relname)
    INTO v_views
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'p', 'f')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = c.oid AND d.deptype = 'e');
  IF v_views IS NOT NULL THEN
    RAISE EXCEPTION
      'relation(s) in public are not plain tables (%) — the policy-derived '
      'whitelist in this migration cannot see them, but REVOKE ON ALL TABLES '
      'can. Extend the derivation before adding one. '
      '(v=view, m=matview, p=partitioned, f=foreign)', v_views;
  END IF;

  -- (c2) COLUMN-LEVEL GRANTS, which neither direction above can see.
  --      `has_table_privilege()` reports table-level privileges only, and a
  --      table-level REVOKE does not remove a column-level grant — so a single
  --      `GRANT UPDATE(col)` would survive this migration AND pass both probes,
  --      making the invariant quietly incomplete rather than wrong-and-loud.
  --      There are none today: `pg_attribute.attacl` is null on every column in
  --      `public` (information_schema.column_privileges shows 708 rows, but
  --      those are table-level grants expanded per column — do not read that
  --      number as column grants, which is the trap this comment exists for).
  SELECT string_agg(c.relname || '.' || a.attname, ', ' ORDER BY c.relname, a.attname)
    INTO v_colacl
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
     AND (a.attacl::text LIKE '%authenticated=%' OR a.attacl::text LIKE '%anon=%');
  IF v_colacl IS NOT NULL THEN
    RAISE EXCEPTION
      'column-level grants to a client role exist (%) — a table-level REVOKE '
      'does not remove them and has_table_privilege() cannot see them, so the '
      'whitelist invariant would be incomplete. Revoke them explicitly or '
      'extend the probes to column granularity.', v_colacl;
  END IF;

  -- (d) THE DEFAULT-PRIVILEGE CHANGE, asked of a real object rather than of the
  --     catalogue. Local and production disagree about defaults by construction
  --     (§7.39), so only a probe that runs wherever the migration runs can
  --     answer for production.
  EXECUTE 'CREATE TABLE public.__auth_default_probe (id INT)';
  v_leaked := has_table_privilege('authenticated', 'public.__auth_default_probe', 'TRUNCATE')
           OR has_table_privilege('authenticated', 'public.__auth_default_probe', 'SELECT');
  EXECUTE 'DROP TABLE public.__auth_default_probe';
  IF v_leaked THEN
    RAISE EXCEPTION
      'default privileges still reach authenticated on new tables — check WHICH '
      'ROLE owns the pg_default_acl row (this file targets `postgres`; a row '
      'owned by `supabase_admin` cannot be revoked from here).';
  END IF;

  EXECUTE 'CREATE SEQUENCE public.__auth_default_probe_seq';
  v_leaked := has_sequence_privilege('authenticated', 'public.__auth_default_probe_seq', 'USAGE')
           OR has_sequence_privilege('authenticated', 'public.__auth_default_probe_seq', 'UPDATE');
  EXECUTE 'DROP SEQUENCE public.__auth_default_probe_seq';
  IF v_leaked THEN
    RAISE EXCEPTION 'default privileges still reach authenticated on new sequences.';
  END IF;

  RAISE NOTICE 'authenticated grant whitelist complete and exact; defaults closed.';
END
$probe$;
