-- The credit-note trigger records the name the lesson was INVOICED under.
--
-- WHERE THE NAME COMES FROM, and why it matters: the snapshot is taken from
-- the INVOICE ITEM being credited (ii.student_name), not from the students
-- table. A credit note reverses one specific invoice line, so it must name the
-- student exactly as that line named them — otherwise a renamed child produces
-- an invoice saying "Ethan Tan" and a credit note against it saying something
-- else, and the two documents no longer visibly refer to the same person.
--
-- ⚠️ THIS FUNCTION HAS BEEN REDEFINED SIX TIMES. Its body is carried forward
-- from 20260719000300 (contract_legacy_columns), which is the most recent
-- definition — NOT from 20260309000500, where it was first created. Basing a
-- CREATE OR REPLACE on the original silently reverts every later change:
-- writing this migration from the 2026-03 body would have dropped
-- credit_notes.tenant_id, reverted per-tenant reference numbering back to the
-- global sequence, and — worst — moved credit accrual from
-- parent_tenant_balances back to the deprecated parents.credit_balance,
-- quietly reinstating the cross-tenant credit pooling that PRD §5.6 exists to
-- forbid. A NOT NULL constraint caught it; nothing else would have.
--
-- BEFORE EDITING THIS FUNCTION AGAIN:
--   grep -ln "handle_attendance_update" supabase/migrations/*.sql | tail -1
-- and start from that file's body, not this comment's word for it.

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

  -- Only for items predating the snapshot column. A rename between invoicing
  -- and correcting makes this the wrong name — which is precisely the defect
  -- being fixed, and is unavoidable for rows that never recorded one.
  IF v_student_name IS NULL THEN
    SELECT full_name INTO v_student_name FROM students WHERE id = NEW.student_id;
  END IF;

  IF OLD.status IN ('present', 'trial_paid')
     AND NEW.status NOT IN ('present', 'trial_paid')
  THEN
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
