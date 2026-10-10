-- Rollback for 20261006000200_package_draw_at_marking_b.sql (Wave 6, switch ON + backfill).
--
-- ⚠ APPS FIRST: revert the Apps-2 commit and prove the served bundles no longer call package_backlog_preview /
-- draw_package_backlog / package_usage / package_month_funding (§7.31). Engine v33 stays — it is correct in
-- both modes (switch off → it matches packages again, exactly once).
-- ⚠ THE WINDOW CLOSES AT THE FIRST SEAL OF A MONTH CONTAINING DRAWS. Reversing a draw in a sealed month would
-- turn that lesson into a permanent orphan (the old engine never revisits a sealed month). This file REFUSES then.
--
-- WHAT. Reverses every LIVE marking-time draw (value back onto its package), switches every tenant off, and
-- restores the column DEFAULT to false. The lessons become un-invoiced billable lessons again, which the
-- switch-off engine draws or bills at the next run — once.
-- After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000200';

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Added by 20261010000100_single_child_packages (D9, RISK 9): switching off restores the legacy matcher, which
  -- pools every package across siblings — a one-child package would silently pay for a sibling. Refuse first, with
  -- the references, so the operator knows exactly which packages to refund or cancel. Never disable
  -- trg_guard_one_child_packages_flag to push this rollback through.
  IF EXISTS (SELECT 1 FROM parent_packages WHERE student_id IS NOT NULL AND status IN ('active', 'pending')) THEN
    RAISE EXCEPTION 'one-child packages are held (%): refund or cancel them first — switching off restores the legacy matcher, which would pool them across siblings',
      (SELECT string_agg(reference_number, ', ' ORDER BY reference_number) FROM parent_packages
        WHERE student_id IS NOT NULL AND status IN ('active', 'pending'));
  END IF;

  IF EXISTS (
    SELECT 1
      FROM package_applications pa
      JOIN lesson_sessions ls ON ls.id = pa.lesson_session_id
      JOIN classes c          ON c.id = ls.class_id
      JOIN billing_periods bp ON bp.tenant_id = c.tenant_id AND bp.billing_month = to_char(ls.session_date, 'YYYY-MM')
     WHERE pa.invoice_item_id IS NULL AND pa.reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a live package draw sits in a SEALED month — reversing it would orphan the lesson; the B rollback window has closed';
  END IF;

  FOR r IN
    SELECT id, parent_package_id, amount FROM package_applications
     WHERE invoice_item_id IS NULL AND reversed_at IS NULL
     ORDER BY id
  LOOP
    UPDATE package_applications SET reversed_at = now() WHERE id = r.id;
    UPDATE parent_packages SET value_remaining = value_remaining + r.amount WHERE id = r.parent_package_id;
  END LOOP;

  UPDATE tenants SET package_draw_at_marking = false WHERE package_draw_at_marking;
  ALTER TABLE tenants ALTER COLUMN package_draw_at_marking SET DEFAULT false;
END $$;
DROP FUNCTION public.package_backfill_draws();
