-- Teardown for fixtures-trial-onboarding.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-trial-onboarding-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- THIS FIXTURE BUILDS A WHOLE BILLABLE MONTH, which is what makes leaving it
-- behind the most damaging of the nine. It creates a session for EVERY Saturday
-- of the previous month on the seed class and marks EVERY actively-enrolled
-- student present on each — so the rows it leaves are not just its own walk-in,
-- they are attendance attributed to other fixtures' children. A later
-- generate-invoices run bills them.
--
-- It also removes the `billing_periods` SEAL for that month, and the driver's
-- own run may re-create it by generating invoices. A sealed month silently
-- no-ops every later generation (§8a.1), so the seal has to go too or the next
-- session's billing test refuses for a reason it cannot see.
--
-- The month is recomputed here exactly as the fixture computes it — SGT, from
-- the DB clock — so this stays correct as the calendar moves.

BEGIN;

DO $$
DECLARE
  v_tenant UUID := '70000000-0000-0000-0000-000000000001';
  v_month  DATE;
  v_class  UUID := 'fb000000-0000-0000-0000-000000000001';
BEGIN
  v_month := date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')::date)
             - INTERVAL '1 month';

  -- The walk-in and everything hanging off it.
  DELETE FROM attendance a USING students s
    WHERE a.student_id = s.id AND s.full_name = 'Fixture Walkin';
  DELETE FROM student_class_enrolments e USING students s
    WHERE e.student_id = s.id AND s.full_name = 'Fixture Walkin';
  DELETE FROM student_settlements ss USING students s
    WHERE ss.student_id = s.id AND s.full_name = 'Fixture Walkin';
  DELETE FROM students WHERE full_name = 'Fixture Walkin';

  -- Any invoice the driver produced that BILLS one of THIS fixture's lessons —
  -- scoped to our own class, exactly as the attendance/session deletes below are.
  -- A tenant-wide `Generate Invoices` run also invoices the seed's and any sibling
  -- worktree's students for this same month; those rows are NOT ours to delete
  -- (§7.63 — a fixture owns only its own rows). invoice_items go with the invoice
  -- via ON DELETE CASCADE. In normal operation this matches ZERO rows — the walk-in
  -- is unclaimed and nobody else is enrolled in this class, so the fixture produces
  -- no invoice of its own — which is the correct footprint. The scope stays here
  -- for the day this class gains a claimed enrolee.
  --
  -- MUST run BEFORE the lesson_sessions delete below: invoice_items.lesson_session_id
  -- is a RESTRICT FK, so a session that is still invoiced cannot be deleted. Clearing
  -- the invoice first (cascading its items) is what makes that future case tear down
  -- clean instead of aborting on the FK.
  DELETE FROM invoices i
   WHERE i.tenant_id = v_tenant
     AND i.billing_month = to_char(v_month, 'YYYY-MM')
     AND EXISTS (
       SELECT 1 FROM invoice_items ii
        JOIN lesson_sessions ls ON ls.id = ii.lesson_session_id
        WHERE ii.invoice_id = i.id
          AND ls.class_id = v_class);

  -- Every attendance row the fixture wrote across that month, for ANY student —
  -- it marked the whole roster, not just its own child.
  DELETE FROM attendance a
   USING lesson_sessions ls
   WHERE a.lesson_session_id = ls.id
     AND ls.class_id = v_class
     AND ls.session_date >= v_month
     AND ls.session_date <  v_month + INTERVAL '1 month';

  -- Then the sessions themselves, but only those now unreferenced — a sibling
  -- worktree may have marked its own child on one of these dates.
  DELETE FROM lesson_sessions ls
   WHERE ls.class_id = v_class
     AND ls.session_date >= v_month
     AND ls.session_date <  v_month + INTERVAL '1 month'
     AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = ls.id);

  -- The seal for that month. The fixture's own setup clears this too (symmetric),
  -- and the load-bearing assertion is that the driver does NOT seal, so this is
  -- defensive. billing_periods is one row per (tenant, month) with no class axis,
  -- so it stays tenant+month-scoped to match the setup's own DELETE.
  DELETE FROM billing_periods
    WHERE tenant_id = v_tenant AND billing_month = to_char(v_month, 'YYYY-MM');

  -- The class this fixture owns, and the effective-dated rate its trigger made.
  -- It used to BORROW the seed class, which is what broke CI on 2026-08-01; now
  -- that it creates one, the teardown has to remove it or the round-trip check
  -- reports a class left behind.
  DELETE FROM class_rates WHERE class_id = v_class;
  DELETE FROM classes     WHERE id       = v_class;

  RAISE NOTICE 'torn down trial-onboarding for billing month %',
    to_char(v_month, 'YYYY-MM');
END $$;

COMMIT;

-- Expect 0, 0, 0. seed_class_intact = 1 — the class stays, only its sessions go.
SELECT
  (SELECT count(*) FROM students WHERE full_name = 'Fixture Walkin')     AS walkin,
  (SELECT count(*) FROM billing_periods
    WHERE tenant_id = '70000000-0000-0000-0000-000000000001'
      AND billing_month = to_char(
            date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')::date)
            - INTERVAL '1 month', 'YYYY-MM'))                            AS seal,
  (SELECT count(*) FROM invoices i
    WHERE i.tenant_id = '70000000-0000-0000-0000-000000000001'
      AND i.billing_month = to_char(
            date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')::date)
            - INTERVAL '1 month', 'YYYY-MM')
      AND EXISTS (SELECT 1 FROM invoice_items ii
                    JOIN lesson_sessions ls ON ls.id = ii.lesson_session_id
                   WHERE ii.invoice_id = i.id
                     AND ls.class_id = 'fb000000-0000-0000-0000-000000000001')) AS invoices,
  (SELECT count(*) FROM classes
    WHERE tenant_id = '70000000-0000-0000-0000-000000000001')            AS seed_class_intact,
  (SELECT count(*) FROM classes
    WHERE id = 'fb000000-0000-0000-0000-000000000001')                   AS own_class;
