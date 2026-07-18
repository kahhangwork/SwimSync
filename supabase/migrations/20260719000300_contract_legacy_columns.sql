-- ============================================================
-- Multi-tenancy phase 4 — the CONTRACT step.
--
-- Phase 1 deliberately kept `parents.credit_balance` and `coaches.paynow_qr_url`
-- after copying their values to `parent_tenant_balances` and `tenants`, because
-- both still had live readers across the two apps and the engine. Dropping them
-- then would have shipped a broken deploy — the web apps deploy on a git push
-- while migrations need a separate manual `supabase db push`, so the two can
-- never land atomically.
--
-- Phase 4 moved the last reader of each. This drops them, and removes the
-- dual-write that kept the deprecated credit column in step.
--
-- ⚠️ ORDER MATTERS ACROSS THE DEPLOY, and this is the mirror image of the
-- expand step: the READERS must be live BEFORE this runs. Apply it only after
-- the app deploy carrying the phase-4 frontend has gone out. Run it first and
-- the currently-deployed apps start querying a column that no longer exists.
--
-- Leaving the dual-write in place after the drop is the failure this file
-- exists to prevent: handle_attendance_update would raise on every attendance
-- correction, which is a live coach-facing path.
-- ============================================================

-- ------------------------------------------------------------
-- Trigger: drop the dual-write to parents.credit_balance.
-- Otherwise identical to 20260718001200 — only the last UPDATE is removed.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_attendance_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id       UUID;
  v_item_amount   NUMERIC;
  v_invoice_id    UUID;
  v_parent_id     UUID;
  v_tenant_id     UUID;
  v_ref           TEXT;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT ii.id, ii.amount, ii.invoice_id, i.parent_id, i.tenant_id
  INTO   v_item_id, v_item_amount, v_invoice_id, v_parent_id, v_tenant_id
  FROM   invoice_items ii
  JOIN   invoices      i ON i.id = ii.invoice_id
  WHERE  ii.lesson_session_id = NEW.lesson_session_id
    AND  ii.student_id        = NEW.student_id
  LIMIT  1;

  IF v_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM students WHERE id = NEW.student_id;
  END IF;

  IF OLD.status IN ('present', 'trial_paid')
     AND NEW.status NOT IN ('present', 'trial_paid')
  THEN
    v_ref := next_credit_note_ref(v_tenant_id);

    INSERT INTO credit_notes (
      reference_number, parent_id, student_id, invoice_id, invoice_item_id,
      lesson_session_id, amount, original_status, corrected_status,
      status, reason, issued_at, tenant_id
    ) VALUES (
      v_ref, v_parent_id, NEW.student_id, v_invoice_id, v_item_id,
      NEW.lesson_session_id, v_item_amount, OLD.status, NEW.status,
      'available', NEW.edit_reason, NOW(), v_tenant_id
    );

    -- Credit accrues to the business that issued it, and only there.
    INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
    VALUES (v_parent_id, v_tenant_id, v_item_amount)
    ON CONFLICT (parent_id, tenant_id) DO UPDATE
      SET credit_balance = parent_tenant_balances.credit_balance + EXCLUDED.credit_balance,
          updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- Final safety check before dropping. If a balance was somehow only ever
-- written to the deprecated column, dropping it destroys money owed to a real
-- family — so refuse rather than proceed.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_stranded NUMERIC;
BEGIN
  SELECT COALESCE(SUM(p.credit_balance), 0) INTO v_stranded
    FROM parents p
   WHERE p.credit_balance <> 0
     AND NOT EXISTS (
       SELECT 1 FROM parent_tenant_balances b
        WHERE b.parent_id = p.id AND b.credit_balance <> 0
     );

  IF v_stranded > 0 THEN
    RAISE EXCEPTION
      'refusing to drop parents.credit_balance: % of credit exists there with no matching per-tenant balance. Migrate it first.',
      v_stranded;
  END IF;
END $$;

ALTER TABLE parents DROP COLUMN credit_balance;
ALTER TABLE coaches DROP COLUMN paynow_qr_url;
