-- A correction to a PACKAGE-FUNDED lesson restores the package, not cash.
--
-- The credit-note trigger fires when a coach corrects an already-invoiced
-- lesson from billable to non-billable. For an ad-hoc line the remedy is a
-- cash credit note (unchanged below). For a line the parent prepaid via a
-- package, cash credit would be the WRONG POT: it moves prepaid value into
-- the refund-liability pool the two-pot design keeps separate
-- (PACKAGES_DESIGN.md §1), and its amount is the package rate, which is not
-- money the business ever owed in cash. The draw is reversed instead: the
-- ledger row is marked reversed and the value goes back on the package —
-- even one that has since EXPIRED, because value wrongly taken is returned
-- regardless (the CHECK value_remaining <= total_value bounds it).
--
-- REFUNDED AT MOST ONCE, structurally. The reversal targets the item's LIVE
-- application (reversed_at IS NULL — at most one, by partial unique index).
-- If the item has only a REVERSED application, a previous correction already
-- refunded it: the trigger returns without issuing anything, so a
-- present→absent→present→absent flip-flop cannot restore twice — and cannot
-- fall through to the cash path and refund the same line a second time in a
-- different currency.
--
-- ⚠️ THIS FUNCTION HAS BEEN REDEFINED SEVEN TIMES. This body is carried
-- forward from 20260719001700 (credit-note name snapshots), the most recent
-- definition. Basing an edit on an older body silently reverts every later
-- change (that nearly shipped once — see 20260719001700's header).
-- BEFORE EDITING AGAIN:
--   grep -ln "handle_attendance_update" supabase/migrations/*.sql | tail -1
-- and start from that file's body.
--
-- CREATE OR REPLACE, never DROP: a DROP takes the function's grants with it
-- (§8.7), and this is a live production path that has broken twice in
-- migrations already (§7.21, 20260718001000's header).

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

  -- Only for items predating the snapshot column. A rename between invoicing
  -- and correcting makes this the wrong name — which is precisely the defect
  -- being fixed, and is unavoidable for rows that never recorded one.
  IF v_student_name IS NULL THEN
    SELECT full_name INTO v_student_name FROM students WHERE id = NEW.student_id;
  END IF;

  IF OLD.status IN ('present', 'trial_paid')
     AND NEW.status NOT IN ('present', 'trial_paid')
  THEN
    -- ── Package-funded line? Restore the package, issue no cash credit ──────
    -- Prefer the live application; a reversed one means "already refunded".
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
           AND reversed_at IS NULL;  -- races collapse to a single reversal

        IF FOUND THEN
          UPDATE parent_packages
             SET value_remaining = value_remaining + v_app_amount
           WHERE id = v_package_id;
        END IF;
      END IF;
      -- Live or already-reversed: this line's money lives in the package
      -- ledger. It must never ALSO produce a cash credit note.
      RETURN NEW;
    END IF;

    -- ── Ad-hoc line: the existing cash credit-note path, unchanged ──────────
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
