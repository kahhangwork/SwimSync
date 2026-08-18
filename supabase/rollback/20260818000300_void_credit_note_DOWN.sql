-- DOWN for 20260818000300_void_credit_note.sql
--
-- ⚠ CAVEAT — IRREVERSIBLE HISTORY LOSS IF ANY VOID HAS RUN. Dropping
-- credit_applications.reversed_at/reversed_by erases WHICH draws were reversed by
-- a void_credit_note(). After this DOWN, the audit_log 'credit_note_voided' rows
-- are the ONLY record of what was voided, and the restored trigger/RPC will treat
-- a previously-reversed draw as LIVE again (double-counting its credit). Do NOT
-- roll back past a live void without first exporting the reversed rows:
--   SELECT * FROM credit_applications WHERE reversed_at IS NOT NULL;
-- Local/prod today hold 0 credit_notes, so this is a no-op there.
--
-- Order: drop void_credit_note (it references reversed_at) → restore the trigger
-- and apply_credit_to_invoice to their 20260818000100 / 20260818000200 bodies
-- (neither references reversed_at) → drop the columns last.

DROP FUNCTION IF EXISTS public.void_credit_note(UUID, TEXT);

-- Restore audit_log_tenant_of to the 20260813000200 body (without the
-- 'credit_note' arm). Safe once void_credit_note is gone — nothing else audits
-- under 'credit_note'.
CREATE OR REPLACE FUNCTION public.audit_log_tenant_of(p_entity_type text, p_entity_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
BEGIN
  CASE p_entity_type
    WHEN 'Student' THEN
      SELECT s.tenant_id INTO v_tenant FROM students s WHERE s.id = p_entity_id;
    WHEN 'Class' THEN
      SELECT c.tenant_id INTO v_tenant FROM classes c WHERE c.id = p_entity_id;
    WHEN 'lesson_session' THEN
      SELECT c.tenant_id INTO v_tenant
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE ls.id = p_entity_id;
    WHEN 'Profile' THEN
      SELECT p.tenant_id INTO v_tenant FROM profiles p WHERE p.id = p_entity_id;
    WHEN 'Coach' THEN
      SELECT c.tenant_id INTO v_tenant FROM coaches c WHERE c.id = p_entity_id;
    WHEN 'ParentTenant' THEN
      v_tenant := NULL;
    WHEN 'Tenant' THEN
      v_tenant := p_entity_id;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$function$;

-- ── Restore handle_attendance_update to the EXACT 20260818000100 body ─────────
-- Byte-faithful to 20260818000100_credit_note_double_credit_fix.sql lines 121-302
-- (the §8.68 symmetric trigger) — WITHOUT Item 3's two edits.
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
  v_cn_id         UUID;
  v_cn_status     TEXT;
  v_cn_applied_inv UUID;
  v_cn_drawn      BOOLEAN;
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

    SELECT id, status INTO v_cn_id, v_cn_status
    FROM credit_notes WHERE invoice_item_id = v_item_id;

    IF v_cn_id IS NOT NULL THEN
      IF v_cn_status = 'reversed' THEN
        UPDATE credit_notes
           SET status           = 'available',
               original_status  = OLD.status,
               corrected_status = NEW.status,
               reason           = NEW.edit_reason,
               issued_at        = NOW(),
               reversed_at      = NULL,
               reversed_by      = NULL,
               email_sent_at    = NULL
         WHERE id = v_cn_id;

        INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
        VALUES (v_parent_id, v_tenant_id, v_item_amount)
        ON CONFLICT (parent_id, tenant_id) DO UPDATE
          SET credit_balance = parent_tenant_balances.credit_balance + EXCLUDED.credit_balance,
              updated_at = NOW();
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

  ELSIF OLD.status NOT IN ('present', 'trial_paid')
        AND NEW.status IN ('present', 'trial_paid')
  THEN
    SELECT id, status, applied_to_invoice_id
      INTO v_cn_id, v_cn_status, v_cn_applied_inv
    FROM credit_notes
    WHERE invoice_item_id = v_item_id AND status <> 'reversed'
    FOR UPDATE;

    IF v_cn_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS (SELECT 1 FROM credit_applications ca
                    WHERE ca.credit_note_id = v_cn_id)
    INTO v_cn_drawn;

    IF v_cn_drawn OR v_cn_status <> 'available' OR v_cn_applied_inv IS NOT NULL THEN
      RAISE EXCEPTION
        'credit note % for this lesson has already been applied to an invoice; it must be reversed manually before this lesson can be un-corrected',
        v_cn_id
        USING ERRCODE = 'CN001';
    END IF;

    UPDATE credit_notes
       SET status = 'reversed', reversed_at = NOW(), reversed_by = auth.uid()
     WHERE id = v_cn_id;

    UPDATE parent_tenant_balances
       SET credit_balance = credit_balance - v_item_amount, updated_at = NOW()
     WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Restore apply_credit_to_invoice to the 20260818000200 body (no reversed filter) ─
CREATE OR REPLACE FUNCTION public.apply_credit_to_invoice(p_invoice_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_parent_id  UUID;
  v_tenant_id  UUID;
  v_gross      NUMERIC(10, 2);
  v_package    NUMERIC(10, 2);
  v_cash       NUMERIC(10, 2);
  v_balance    NUMERIC(10, 2);
  v_cap        NUMERIC(10, 2);
  v_remaining  NUMERIC(10, 2);
  v_allocated  NUMERIC(10, 2) := 0;
  v_existing   NUMERIC(10, 2);
  v_net        NUMERIC(10, 2);
  v_note       RECORD;
  v_used       NUMERIC(10, 2);
  v_note_rem   NUMERIC(10, 2);
  v_draw       NUMERIC(10, 2);
BEGIN
  SELECT parent_id, tenant_id, gross_amount, package_applied
    INTO v_parent_id, v_tenant_id, v_gross, v_package
    FROM invoices
   WHERE id = p_invoice_id;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'apply_credit_to_invoice: invoice % not found', p_invoice_id;
  END IF;

  v_cash := GREATEST(v_gross - v_package, 0);

  SELECT credit_balance INTO v_balance
    FROM parent_tenant_balances
   WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id
   FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);

  SELECT COALESCE(SUM(amount), 0) INTO v_existing
    FROM credit_applications
   WHERE invoice_id = p_invoice_id;
  IF v_existing > 0 THEN
    RETURN v_existing;
  END IF;

  v_cap := LEAST(v_cash, v_balance);
  v_remaining := v_cap;

  IF v_cap > 0 THEN
    FOR v_note IN
      SELECT id, amount
        FROM credit_notes
       WHERE parent_id = v_parent_id
         AND tenant_id = v_tenant_id
         AND status = 'available'
       ORDER BY issued_at, id
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      SELECT COALESCE(SUM(amount), 0) INTO v_used
        FROM credit_applications
       WHERE credit_note_id = v_note.id;

      v_note_rem := v_note.amount - v_used;

      IF v_note_rem <= 0 THEN
        UPDATE credit_notes SET status = 'applied' WHERE id = v_note.id;
        CONTINUE;
      END IF;

      v_draw := LEAST(v_note_rem, v_remaining);

      INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
        VALUES (v_note.id, p_invoice_id, v_draw);

      IF v_draw >= v_note_rem THEN
        UPDATE credit_notes
           SET status = 'applied',
               applied_to_invoice_id = p_invoice_id,
               applied_at = NOW()
         WHERE id = v_note.id;
      END IF;

      v_remaining := v_remaining - v_draw;
    END LOOP;

    v_allocated := v_cap - v_remaining;

    IF v_allocated > 0 THEN
      UPDATE parent_tenant_balances
         SET credit_balance = credit_balance - v_allocated,
             updated_at = NOW()
       WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id;
    END IF;
  END IF;

  v_net := v_cash - v_allocated;
  UPDATE invoices
     SET credit_applied = v_allocated,
         net_amount     = v_net,
         status         = CASE WHEN v_net = 0 THEN 'paid'::invoice_status
                               ELSE 'outstanding'::invoice_status END
   WHERE id = p_invoice_id;

  RETURN v_allocated;
END;
$$;

-- Columns last: nothing restored above references them.
ALTER TABLE credit_applications
  DROP COLUMN IF EXISTS reversed_by,
  DROP COLUMN IF EXISTS reversed_at;
