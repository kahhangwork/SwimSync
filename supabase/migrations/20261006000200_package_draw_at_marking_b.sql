-- Wave 6, migration B: SWITCH ON — package lessons draw at marking, for every business, from now.
-- docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md (Deploy order step B; decisions D1–D7 are the user's).
--
-- WHAT. In ONE transaction:
--   1. capture every active package's stored and (switch-off) live balance;
--   2. flip tenants.package_draw_at_marking ON for every tenant, and make it the column DEFAULT;
--   3. BACKFILL: draw every un-invoiced, undrawn, unsettled billable lesson in an UNSEALED month, oldest first
--      (session_date, student_id — the engine's and the simulation's order), through package_draw_for — the
--      one matcher. A lesson no package can fund stays ad-hoc and bills at the next run, exactly as today;
--   4. SELF-CHECK (RISK 4): every active package's stored balance = its pre-B balance − what step 3 drew, and
--      no lesson is both invoiced and drawn. Any mismatch RAISEs and aborts `db push` — nothing is written.
--      The pre-B LIVE balance is compared too, but a difference there is EXPECTED wherever the old simulation
--      subtracted lessons the backfill deliberately skips (settled, or in a sealed month), so it is REPORTED
--      (NOTICE), never fatal.
--
-- PRECONDITION: engine v33 (fails closed on package_mode_unreadable; drops drawn lessons) is deployed. With an
-- older engine, a drawn lesson would be invoiced again — the PK002 backstop would refuse that write.
-- Prod read before push (plan §Deploy order): Little Orcas's lessons to be drawn, count, sum, expected balance;
-- whether Sep/Aug were generated since 2026-10-06; no Generate in flight.
--
-- ROLLBACK: supabase/rollback/20261006000200_package_draw_at_marking_b_DOWN.sql — APPS FIRST. Valid only while
-- no drawn lesson sits in a sealed month (the DOWN refuses otherwise).

-- The backfill as a function, so pgTAP can prove it (package_draw_at_marking_b.test.sql). Draws, oldest first
-- (session_date, student_id — the engine's and the old simulation's order), every billable lesson of a
-- switch-ON tenant in an UNSEALED month that the matcher lets a package fund. package_draw_for applies the
-- eligibility (not invoiced, not drawn, not settled) itself — no second copy of the rule. Idempotent: a second
-- call draws nothing. Callable by nobody but this migration (§7.78).
CREATE FUNCTION public.package_backfill_draws()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  les RECORD;
  v_n INTEGER := 0;
BEGIN
  FOR les IN
    SELECT a.lesson_session_id, a.student_id
      FROM attendance a
      JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
      JOIN classes c          ON c.id = ls.class_id
      JOIN tenants t          ON t.id = c.tenant_id
     WHERE t.package_draw_at_marking
       AND a.status IN ('present', 'trial_paid')
       AND NOT EXISTS (SELECT 1 FROM billing_periods bp
                        WHERE bp.tenant_id = c.tenant_id
                          AND bp.billing_month = to_char(ls.session_date, 'YYYY-MM'))
     ORDER BY ls.session_date, a.student_id
  LOOP
    IF package_draw_for(les.lesson_session_id, les.student_id) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.package_backfill_draws() FROM PUBLIC, anon, authenticated, service_role;

-- ONE statement (a DO block is atomic on its own), so capture → flip → backfill → self-check commit together
-- or not at all, whether or not the runner wraps the file in a transaction.
DO $$
DECLARE
  r     RECORD;
  v_n   INTEGER := 0;
  v_bad INTEGER := 0;
BEGIN
  -- 1. Capture (switch-off semantics: the live balance is still the simulation).
  CREATE TEMP TABLE w6b_before AS
  SELECT b.parent_package_id, b.value_remaining AS stored_before, b.live_value_remaining AS live_before
    FROM package_live_balances() b;

  -- 2. Switch on, everywhere, and for every business created from now on.
  UPDATE tenants SET package_draw_at_marking = true WHERE NOT package_draw_at_marking;
  ALTER TABLE tenants ALTER COLUMN package_draw_at_marking SET DEFAULT true;

  -- 3. Backfill (the function above — the one place the rule is applied).
  v_n := package_backfill_draws();
  RAISE NOTICE 'Wave 6 B backfill: % lesson(s) drawn', v_n;

  -- 4. Self-check.
  FOR r IN
    SELECT w.parent_package_id, w.stored_before, w.live_before, pp.value_remaining AS stored_after,
           COALESCE((SELECT sum(pa.amount) FROM package_applications pa
                      WHERE pa.parent_package_id = w.parent_package_id
                        AND pa.invoice_item_id IS NULL AND pa.reversed_at IS NULL), 0) AS drawn
      FROM w6b_before w
      JOIN parent_packages pp ON pp.id = w.parent_package_id
  LOOP
    IF r.stored_after <> r.stored_before - r.drawn THEN
      RAISE WARNING 'package %: stored % <> before % - drawn %', r.parent_package_id, r.stored_after, r.stored_before, r.drawn;
      v_bad := v_bad + 1;
    END IF;
    IF r.stored_after <> r.live_before THEN
      RAISE NOTICE 'package %: live before % vs stored after % (expected only where settled / sealed-month lessons exist)',
        r.parent_package_id, r.live_before, r.stored_after;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM package_applications pa
               JOIN invoice_items ii ON ii.lesson_session_id = pa.lesson_session_id AND ii.student_id = pa.student_id
              WHERE pa.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'Wave 6 B self-check: a lesson is both invoiced and drawn - aborting';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Wave 6 B self-check: % package balance(s) do not reconcile - aborting', v_bad;
  END IF;

  DROP TABLE w6b_before;
END $$;
