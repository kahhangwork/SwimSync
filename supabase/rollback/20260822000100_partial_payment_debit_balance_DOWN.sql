-- ROLLBACK for 20260822000100_partial_payment_debit_balance.sql.
-- Committed BEFORE the deploy (the 20260804/20260806/20260813 pattern).
--
-- Restores void_credit_note, handle_attendance_update and apply_credit_to_invoice
-- to their 20260818000300 bodies (copied VERBATIM from that applied migration —
-- the byte-exact pre-change source, §7.115), then drops the three added columns.
-- Order matters: the functions are reverted FIRST (the old bodies reference none
-- of the new columns), so nothing references them when they are dropped.
--
-- GUARD: refuses to roll back once the feature has moved real money — any non-zero
-- debit_balance / balance_adjustment, or any debited_at draw, means a debit was
-- posted or folded, and DROPPING the columns would silently lose that financial
-- state. On prod today this is a clean no-op (0 credit notes → all zero/NULL).
--
-- Rehearsal (2026-08-22): DOWN applied against the migrated local DB — guard
-- passed, the three functions restored, all four columns dropped, exit 0 (drop
-- order proven: no object references the columns after the functions revert). The
-- migration was then re-applied and the full pgTAP suite ran green. NOT yet run:
-- the OLD test bodies against the reverted functions (needs partial_payment.test.sql
-- removed + void_credit_note.test.sql reverted) — do that at deploy for the full §7.93 pass.

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM parent_tenant_balances WHERE debit_balance <> 0;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'rollback refused: % parent(s) hold a non-zero debit_balance — rolling back would lose that charge', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM invoices WHERE balance_adjustment <> 0;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'rollback refused: % invoice(s) carry a balance_adjustment', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM credit_applications WHERE debited_at IS NOT NULL;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'rollback refused: % application(s) were recovered as a debit', v_bad; END IF;
END $$;


-- ── Restore void_credit_note() to its 20260818000300 body ────────────────────
CREATE OR REPLACE FUNCTION public.void_credit_note(p_note_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_parent   UUID;
  v_amount   NUMERIC(10, 2);
  v_status   TEXT;
  v_ref      TEXT;
  v_drawn    NUMERIC(10, 2) := 0;
  v_undrawn  NUMERIC(10, 2);
  v_new_bal  NUMERIC(10, 2);
  v_app      RECORD;
  v_reopened JSONB := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to void a credit note';
  END IF;

  -- Lock the note; scope + amount come FROM the row. Serialises against the
  -- trigger's FOR UPDATE (20260818000100) and the engine's apply_credit_to_invoice.
  SELECT tenant_id, parent_id, amount, status, reference_number
    INTO v_tenant, v_parent, v_amount, v_status, v_ref
    FROM credit_notes WHERE id = p_note_id FOR UPDATE;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'credit note not found';
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may void a credit note';
  END IF;

  IF v_status = 'reversed' THEN
    RAISE EXCEPTION 'that credit note is already reversed';
  END IF;

  -- ── Unwind each LIVE draw: mark reversed, reopen its invoice ────────────────
  -- A note can have drawn against more than one invoice over time (partial draws),
  -- so this is a loop. Each reopened invoice gets its share back and returns to
  -- 'outstanding'; settlement stamps are cleared (see header, RISK 4).
  FOR v_app IN
    SELECT id, invoice_id, amount
      FROM credit_applications
     WHERE credit_note_id = p_note_id AND reversed_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE credit_applications
       SET reversed_at = NOW(), reversed_by = v_actor
     WHERE id = v_app.id;

    UPDATE invoices
       SET credit_applied  = credit_applied - v_app.amount,
           net_amount      = net_amount + v_app.amount,
           status          = 'outstanding',
           paid_at         = NULL,
           paid_marked_by  = NULL,
           paid_claimed_at = NULL
     WHERE id = v_app.invoice_id;

    v_drawn := v_drawn + v_app.amount;
    v_reopened := v_reopened
      || jsonb_build_object('invoice_id', v_app.invoice_id, 'amount', v_app.amount);
  END LOOP;

  v_undrawn := v_amount - v_drawn;

  -- ── Mark the note reversed, and CLEAR its spend signals ────────────────────
  -- Clearing applied_to_invoice_id/applied_at matters for the re-activation path:
  -- handle_attendance_update re-activates a 'reversed' note on a later correction
  -- and does NOT itself clear these — a stale applied_to_invoice_id would then
  -- re-trip CN001 on the next un-correction (defence-in-depth with the trigger's
  -- own clear, added below).
  UPDATE credit_notes
     SET status                = 'reversed',
         reversed_at           = NOW(),
         reversed_by           = v_actor,
         applied_to_invoice_id = NULL,
         applied_at            = NULL
   WHERE id = p_note_id;

  -- ── Balance: remove the UNDRAWN remainder only ─────────────────────────────
  -- At issue the whole amount was added to the pool; each draw already removed
  -- its part (apply_credit_to_invoice / the trigger). So the note's CURRENT pool
  -- contribution is amount − drawn = the undrawn remainder. The drawn part is not
  -- returned to the pool — it returns to the tenant as the reopened invoices'
  -- increased net. Net pool contribution of this note after the void: 0.
  IF v_undrawn <> 0 THEN
    UPDATE parent_tenant_balances
       SET credit_balance = credit_balance - v_undrawn, updated_at = NOW()
     WHERE parent_id = v_parent AND tenant_id = v_tenant;
  END IF;

  SELECT credit_balance INTO v_new_bal
    FROM parent_tenant_balances
   WHERE parent_id = v_parent AND tenant_id = v_tenant;
  IF COALESCE(v_new_bal, 0) < 0 THEN
    RAISE EXCEPTION
      'voiding % would drive the credit balance negative (to %)', v_ref, v_new_bal;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, tenant_id, new_value)
  VALUES (
    v_actor, 'credit_note_voided', 'credit_note', p_note_id, v_tenant,
    jsonb_build_object(
      'reference', v_ref,
      'reason', btrim(p_reason),
      'amount', v_amount,
      'drawn_reversed', v_drawn,
      'undrawn_removed', v_undrawn,
      'invoices_reopened', v_reopened
    )
  );
END;
$$;

COMMENT ON FUNCTION public.void_credit_note(UUID, TEXT) IS
  'Tenant-admin action to void a credit note: reverses its live credit_applications (marking them reversed_at, never deleting), reopens each drawn invoice to outstanding (clearing paid_at/paid_marked_by/paid_claimed_at, leaving payment_records), removes the undrawn remainder from the pooled balance, clears the note''s spend signals so a later re-activation cannot re-trip CN001, and audits. No parent email in v1. Authority: is_tenant_admin of the note''s own business only.';


-- ── Restore handle_attendance_update() to its 20260818000300 body ────────────
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

  -- Not an already-invoiced lesson: neither correction nor un-correction applies.
  IF v_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM students WHERE id = NEW.student_id;
  END IF;

  IF v_student_name IS NULL THEN
    SELECT full_name INTO v_student_name FROM students WHERE id = NEW.student_id;
  END IF;

  -- ══ CORRECTION: billable → non-billable ═══════════════════════════════════
  IF OLD.status IN ('present', 'trial_paid')
     AND NEW.status NOT IN ('present', 'trial_paid')
  THEN
    -- ── Package-funded line? Restore the package, issue no cash credit ───────
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

    -- ── Ad-hoc cash line ────────────────────────────────────────────────────
    -- One row per invoice_item_id (UNIQUE). Re-activate a previously reversed
    -- note rather than mint a second — this is the fix for the double-credit.
    SELECT id, status INTO v_cn_id, v_cn_status
    FROM credit_notes WHERE invoice_item_id = v_item_id;

    IF v_cn_id IS NOT NULL THEN
      IF v_cn_status = 'reversed' THEN
        -- Re-issue: reset email_sent_at so the re-issued credit is announced
        -- again (all three send paths filter email_sent_at IS NULL), and clear
        -- the void trail. The coach app re-fires notifyCreditNoteEmails on the
        -- leave-present save, so it emails automatically.
        -- ⟨ITEM 3, edit B⟩ also clear applied_to_invoice_id/applied_at: a note
        -- voided by void_credit_note() cleared them, but the un-correction path
        -- (20260818000100) that marks 'reversed' does not — clearing here makes
        -- "a reversed note carries no spend signals" structural for BOTH paths.
        UPDATE credit_notes
           SET status                = 'available',
               original_status       = OLD.status,
               corrected_status      = NEW.status,
               reason                = NEW.edit_reason,
               issued_at             = NOW(),
               reversed_at           = NULL,
               reversed_by           = NULL,
               email_sent_at         = NULL,
               applied_to_invoice_id = NULL,
               applied_at            = NULL
         WHERE id = v_cn_id;

        INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
        VALUES (v_parent_id, v_tenant_id, v_item_amount)
        ON CONFLICT (parent_id, tenant_id) DO UPDATE
          SET credit_balance = parent_tenant_balances.credit_balance + EXCLUDED.credit_balance,
              updated_at = NOW();
      END IF;
      -- An 'available'/'applied' note already covers this line: idempotent,
      -- never a second credit.
      RETURN NEW;
    END IF;

    -- First correction of this line: issue a fresh note.
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

  -- ══ UN-CORRECTION: non-billable → billable ════════════════════════════════
  ELSIF OLD.status NOT IN ('present', 'trial_paid')
        AND NEW.status IN ('present', 'trial_paid')
  THEN
    -- A live cash credit note for this line? (Package-funded lines leave none,
    -- so they fall through untouched — their re-application is out of scope.)
    -- FOR UPDATE locks the note so the billing engine cannot draw it down between
    -- this check and the reversal (RISK 2). This closes the trigger-vs-trigger
    -- window; engine-side note locking is the complete fix — see BACKLOG.
    SELECT id, status, applied_to_invoice_id
      INTO v_cn_id, v_cn_status, v_cn_applied_inv
    FROM credit_notes
    WHERE invoice_item_id = v_item_id AND status <> 'reversed'
    FOR UPDATE;

    IF v_cn_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- ⟨ITEM 3, edit A⟩ `AND ca.reversed_at IS NULL`: a draw reversed by a void is
    -- no longer a spend signal. Without it, a note that was voided (its draws
    -- reversed) then re-activated would carry those reversed rows forever and
    -- re-trip CN001 on every future un-correction, with no way out.
    SELECT EXISTS (SELECT 1 FROM credit_applications ca
                    WHERE ca.credit_note_id = v_cn_id
                      AND ca.reversed_at IS NULL)
    INTO v_cn_drawn;

    -- Reverse ONLY a pristine, untouched note. THREE independent spend signals
    -- (RISK 3), mirroring the app's isSendableNote doctrine — one signal is not
    -- enough: an 'applied' note can carry NULL applied_to_invoice_id, and an
    -- application row can exist before status flips. Any one means the credit has
    -- already left the pool, so reversing it would drive the balance negative.
    IF v_cn_drawn OR v_cn_status <> 'available' OR v_cn_applied_inv IS NOT NULL THEN
      -- The credit already discounted another invoice; reversing it here would
      -- silently reopen a past (possibly sealed/paid) invoice. Refuse instead.
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


-- ── Restore apply_credit_to_invoice() to its 20260818000300 body ────────────
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

  -- Idempotency (under the lock): a prior call already drew for this invoice.
  -- ⟨ITEM 3⟩ reversed draws don't count — a voided invoice can be re-drawn.
  SELECT COALESCE(SUM(amount), 0) INTO v_existing
    FROM credit_applications
   WHERE invoice_id = p_invoice_id AND reversed_at IS NULL;
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

      -- ⟨ITEM 3⟩ a reversed draw is not "used" — it returned to the note.
      SELECT COALESCE(SUM(amount), 0) INTO v_used
        FROM credit_applications
       WHERE credit_note_id = v_note.id AND reversed_at IS NULL;

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


-- ── Grants (unchanged by the feature; re-stated for a clean surface) ─────────
REVOKE ALL     ON FUNCTION public.void_credit_note(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_credit_note(UUID, TEXT) FROM anon, service_role;
GRANT  EXECUTE ON FUNCTION public.void_credit_note(UUID, TEXT) TO authenticated;


-- ── Drop the added columns (nothing references them now) ─────────────────────
ALTER TABLE credit_applications  DROP COLUMN IF EXISTS debited_by;
ALTER TABLE credit_applications  DROP COLUMN IF EXISTS debited_at;
ALTER TABLE parent_tenant_balances DROP COLUMN IF EXISTS debit_balance;
ALTER TABLE invoices             DROP COLUMN IF EXISTS balance_adjustment;
