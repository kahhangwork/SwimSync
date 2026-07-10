-- ============================================================
-- Auto Credit Note Trigger
-- Fires when a coach edits attendance that has already been invoiced.
-- If the status changes from a billable -> non-billable status, a
-- credit note is automatically issued and added to the parent's
-- credit balance.
--
-- Billable (billed on an invoice):  present, trial_paid
-- Non-billable:                     absent, cancelled_rain,
--                                   cancelled_coach, trial_free
--
-- Note: the guard below also checks that an invoice_item actually
-- exists for the lesson, so only genuinely-billed lessons can ever
-- produce a credit note.
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
  v_ref           TEXT;
BEGIN
  -- Nothing to do if status didn't change
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Look up the invoice_item for this session + student
  SELECT ii.id, ii.amount, ii.invoice_id, i.parent_id
  INTO   v_item_id, v_item_amount, v_invoice_id, v_parent_id
  FROM   invoice_items ii
  JOIN   invoices      i ON i.id = ii.invoice_id
  WHERE  ii.lesson_session_id = NEW.lesson_session_id
    AND  ii.student_id        = NEW.student_id
  LIMIT  1;

  -- Not yet invoiced -> nothing to do
  IF v_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Issue a credit note only when going from billable -> non-billable
  IF OLD.status IN ('present', 'trial_paid')
     AND NEW.status NOT IN ('present', 'trial_paid')
  THEN
    -- Generate unique reference: CN-YYYY-NNNN
    v_ref := 'CN-' || to_char(NOW(), 'YYYY') || '-'
             || LPAD(nextval('credit_note_seq')::TEXT, 4, '0');

    INSERT INTO credit_notes (
      reference_number,
      parent_id,
      student_id,
      invoice_id,
      invoice_item_id,
      lesson_session_id,
      amount,
      original_status,
      corrected_status,
      status,
      reason,
      issued_at
    ) VALUES (
      v_ref,
      v_parent_id,
      NEW.student_id,
      v_invoice_id,
      v_item_id,
      NEW.lesson_session_id,
      v_item_amount,
      OLD.status,
      NEW.status,
      'available',
      NEW.edit_reason,
      NOW()
    );

    -- Add credit to the parent's balance
    UPDATE parents
    SET    credit_balance = credit_balance + v_item_amount
    WHERE  id = v_parent_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_update ON attendance;

CREATE TRIGGER trg_attendance_update
  AFTER UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION handle_attendance_update();
