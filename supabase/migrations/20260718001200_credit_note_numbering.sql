-- ============================================================
-- Multi-tenancy: credit-note reference numbers are PER TENANT.
--
-- `credit_note_seq` is a single global sequence, so references ran
-- CN-2026-0001, CN-2026-0002, … across every business on the platform. Two
-- problems, one cosmetic and one not:
--
--   • Each business expects its OWN numbering. A school issuing its third
--     credit note wants CN-2026-0003, not CN-2026-0047.
--   • A shared sequence LEAKS VOLUME. Gaps in a tenant's own numbering tell
--     them exactly how many credit notes every other business issued in
--     between — a competitor can meter a rival's correction rate.
--
-- The uniqueness constraint moves with it: reference_number was globally
-- UNIQUE, which two tenants both numbering from 0001 would immediately
-- violate. It becomes UNIQUE (tenant_id, reference_number) — unique within the
-- business that issued it, which is what a reference number actually means.
-- ============================================================

-- Per-tenant counter. Incremented with UPDATE … RETURNING, which takes a row
-- lock, so two concurrent corrections in the same tenant cannot draw the same
-- number. (A Postgres SEQUENCE would be gap-free-per-tenant only by creating
-- one sequence per tenant, which is worse to manage.)
ALTER TABLE tenants
  ADD COLUMN credit_note_counter INTEGER NOT NULL DEFAULT 0;

-- Start each existing tenant past whatever it has already issued, so no
-- reference is ever reused.
UPDATE tenants t
   SET credit_note_counter = COALESCE(
     (SELECT COUNT(*) FROM credit_notes cn WHERE cn.tenant_id = t.id), 0
   );

ALTER TABLE credit_notes DROP CONSTRAINT credit_notes_reference_number_key;
ALTER TABLE credit_notes
  ADD CONSTRAINT credit_notes_tenant_reference_key
  UNIQUE (tenant_id, reference_number);

/**
 * The next reference for a tenant: CN-<year>-NNNN, numbered within that tenant.
 *
 * SECURITY DEFINER because the credit-note trigger runs as the editing coach,
 * who has no UPDATE on tenants.
 */
CREATE OR REPLACE FUNCTION public.next_credit_note_ref(p_tenant_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE tenants
     SET credit_note_counter = credit_note_counter + 1
   WHERE id = p_tenant_id
  RETURNING credit_note_counter INTO v_n;

  IF v_n IS NULL THEN
    RAISE EXCEPTION 'cannot number a credit note for unknown tenant %', p_tenant_id;
  END IF;

  RETURN 'CN-' || to_char(NOW(), 'YYYY') || '-' || LPAD(v_n::TEXT, 4, '0');
END;
$$;

-- ------------------------------------------------------------
-- Point the trigger at it. Only the reference line changes; everything else
-- is as established in 20260718001000.
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

    INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
    VALUES (v_parent_id, v_tenant_id, v_item_amount)
    ON CONFLICT (parent_id, tenant_id) DO UPDATE
      SET credit_balance = parent_tenant_balances.credit_balance + EXCLUDED.credit_balance,
          updated_at = NOW();

    -- DUAL-WRITE to the deprecated pooled column (expand/contract). Remove in
    -- the same change that moves the last reader of parents.credit_balance.
    UPDATE parents
       SET credit_balance = credit_balance + v_item_amount
     WHERE id = v_parent_id;
  END IF;

  RETURN NEW;
END;
$$;
