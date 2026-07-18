-- ============================================================
-- Multi-tenancy: the auto-credit-note trigger is tenant-aware.
--
-- handle_attendance_update() is a live production path — it fires whenever a
-- coach corrects an already-invoiced lesson from billable to non-billable. The
-- tenant migration broke it in TWO ways, both of which would have thrown on the
-- next real attendance correction:
--
--   1. It inserts into credit_notes, whose tenant_id is now NOT NULL.
--   2. It updates parents.credit_balance — a column the backfill DROPPED,
--      because credit is now held per (parent, tenant).
--
-- Neither was caught by dropping is_superadmin(): a trigger body is not a
-- tracked dependency, so nothing failed at migration time. It surfaced only
-- because the pgTAP fixtures exercise the trigger. That is the same lesson as
-- close_student_enrolment() in 20260718000900 — function bodies are text to
-- Postgres, so they have to be found by reading and by tests, not by the
-- planner.
--
-- WHY THE TENANT COMES FROM THE STUDENT: a credit note belongs to the business
-- whose lesson was corrected. students.tenant_id is that business, and the
-- enrolment guard makes it identical to the class's tenant, so either would do —
-- the student is the shorter path and cannot be NULL.
-- ============================================================

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

  -- Not yet invoiced -> nothing to do
  IF v_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Defensive: an invoice predating the tenant backfill would have no tenant.
  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM students WHERE id = NEW.student_id;
  END IF;

  IF OLD.status IN ('present', 'trial_paid')
     AND NEW.status NOT IN ('present', 'trial_paid')
  THEN
    v_ref := 'CN-' || to_char(NOW(), 'YYYY') || '-'
             || LPAD(nextval('credit_note_seq')::TEXT, 4, '0');

    INSERT INTO credit_notes (
      reference_number, parent_id, student_id, invoice_id, invoice_item_id,
      lesson_session_id, amount, original_status, corrected_status,
      status, reason, issued_at, tenant_id
    ) VALUES (
      v_ref, v_parent_id, NEW.student_id, v_invoice_id, v_item_id,
      NEW.lesson_session_id, v_item_amount, OLD.status, NEW.status,
      'available', NEW.edit_reason, NOW(), v_tenant_id
    );

    -- Credit accrues to the business that issued it, and is spendable only
    -- there. Pools freely across this parent's children WITHIN the tenant;
    -- never crosses to another business's invoice.
    INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
    VALUES (v_parent_id, v_tenant_id, v_item_amount)
    ON CONFLICT (parent_id, tenant_id) DO UPDATE
      SET credit_balance = parent_tenant_balances.credit_balance + EXCLUDED.credit_balance,
          updated_at = NOW();

    -- DUAL-WRITE to the deprecated pooled column (expand/contract — see
    -- 20260718000600). The parent app still reads it, and the invoice engine
    -- still draws from it, until phase 2 moves both to the per-tenant balance.
    -- Keeping it in step means the old readers stay correct for the whole
    -- migration window instead of silently going stale.
    --
    -- REMOVE THIS WRITE in the same change that moves the last reader; leaving
    -- it afterwards would double-count credit across the two sources.
    UPDATE parents
       SET credit_balance = credit_balance + v_item_amount
     WHERE id = v_parent_id;
  END IF;

  RETURN NEW;
END;
$$;
