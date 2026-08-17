-- DOWN for 20260818000100_credit_note_double_credit_fix.sql
--
-- Restores the schema and the trigger body that preceded the fix. It does NOT
-- un-reverse notes the fix reversed, nor re-create balance the dedup removed —
-- a reversal is a corrected ledger state, not damage. Run the UP's effects
-- through by hand only if a specific note must be resurrected.
--
-- NOTE the ordering trap: the trigger body below is the pre-fix one
-- (from 20260720000200). The CHECK is reverted LAST, so if any 'reversed' rows
-- still exist the final ADD CONSTRAINT fails loudly with a check-violation — that
-- IS the guard. Resolve those rows (delete or re-issue) before running this DOWN.

BEGIN;

-- 1. Restore the pre-fix trigger (carried from 20260720000200 verbatim).
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
  v_student_name  TEXT;
  v_app_id        UUID;
  v_app_amount    NUMERIC;
  v_app_reversed  TIMESTAMPTZ;
  v_package_id    UUID;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT ii.id, ii.amount, ii.invoice_id, i.parent_id, i.tenant_id, ii.student_name
  INTO   v_item_id, v_item_amount, v_invoice_id, v_parent_id, v_tenant_id, v_student_name
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

  IF v_student_name IS NULL THEN
    SELECT full_name INTO v_student_name FROM students WHERE id = NEW.student_id;
  END IF;

  IF OLD.status IN ('present', 'trial_paid')
     AND NEW.status NOT IN ('present', 'trial_paid')
  THEN
    SELECT pa.id, pa.amount, pa.reversed_at, pa.parent_package_id
    INTO   v_app_id, v_app_amount, v_app_reversed, v_package_id
    FROM   package_applications pa
    WHERE  pa.invoice_item_id = v_item_id
    ORDER BY (pa.reversed_at IS NULL) DESC, pa.applied_at
    LIMIT  1;

    IF v_app_id IS NOT NULL THEN
      IF v_app_reversed IS NULL THEN
        UPDATE package_applications
           SET reversed_at = NOW(),
               reversed_by = auth.uid()
         WHERE id = v_app_id
           AND reversed_at IS NULL;

        IF FOUND THEN
          UPDATE parent_packages
             SET value_remaining = value_remaining + v_app_amount
           WHERE id = v_package_id;
        END IF;
      END IF;
      RETURN NEW;
    END IF;

    v_ref := next_credit_note_ref(v_tenant_id);

    INSERT INTO credit_notes (
      reference_number, parent_id, student_id, student_name, invoice_id,
      invoice_item_id, lesson_session_id, amount, original_status,
      corrected_status, status, reason, issued_at, tenant_id
    ) VALUES (
      v_ref, v_parent_id, NEW.student_id, v_student_name, v_invoice_id,
      v_item_id, NEW.lesson_session_id, v_item_amount, OLD.status, NEW.status,
      'available', NEW.edit_reason, NOW(), v_tenant_id
    );

    INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
    VALUES (v_parent_id, v_tenant_id, v_item_amount)
    ON CONFLICT (parent_id, tenant_id) DO UPDATE
      SET credit_balance = parent_tenant_balances.credit_balance + EXCLUDED.credit_balance,
          updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Drop the new indexes and audit columns.
DROP INDEX IF EXISTS credit_notes_invoice_item_id_key;
DROP INDEX IF EXISTS credit_notes_lesson_session_id_idx;
ALTER TABLE credit_notes DROP COLUMN IF EXISTS reversed_at;
ALTER TABLE credit_notes DROP COLUMN IF EXISTS reversed_by;

-- 3. Re-add the vestigial column (drift restoration).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspend BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Revert the status CHECK LAST — fails loudly if any 'reversed' row remains.
ALTER TABLE credit_notes DROP CONSTRAINT credit_notes_status_check;
ALTER TABLE credit_notes ADD  CONSTRAINT credit_notes_status_check
  CHECK (status IN ('available', 'applied'));

COMMIT;
