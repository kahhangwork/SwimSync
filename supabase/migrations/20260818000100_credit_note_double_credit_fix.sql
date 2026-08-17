-- Wave D — the re-toggled attendance correction double-credit fix.
--
-- THE BUG (found 2026-08-17 while building credit-note emails, BACKLOG §Wave D):
-- handle_attendance_update() had no absent→present branch. So on a cash line:
--   present→absent : issue credit note #1, +amount to parent_tenant_balances
--   absent→present : reverses NOTHING (OLD='absent' fails the billable guard)
--   present→absent : issues note #2 with a fresh reference, +amount AGAIN
-- One $30 lesson could carry $60 of credit, silently. credit_notes had no
-- unique constraint on invoice_item_id, so nothing stopped the second row.
--
-- THE FIX — a SYMMETRIC ledger, ONE credit_notes row reused per invoice_item_id:
--   present→absent : issue OR re-activate the line's note, +amount
--   absent→present : if the note is undrawn → mark it 'reversed', −amount
--                    if it has ANY credit_applications → RAISE 'CN001'
--                    (the credit is already spent on another invoice; reversing
--                     it is a manual money decision — never done silently)
-- UNIQUE(invoice_item_id) makes "one note per line" structural, which in turn
-- makes "one credit-note email per line" structural (email_sent_at lives on the
-- one row) — so the previously-planned partial email index is redundant and
-- deliberately NOT added.
--
-- Also in this migration (all Wave D, one schema change in flight §7.55):
--   • credit_notes.status gains 'reversed'; reversed_at / reversed_by columns.
--   • a dedup backfill for any historical duplicate the pre-fix trigger minted
--     (prod-only concern — local credit_notes is 0 rows, so this is a no-op
--     locally and must be verified against prod, per the plan's precheck).
--   • credit_notes(lesson_session_id) index for the credit-note-emails filter.
--   • tenants.suspend dropped (vestigial: nothing reads/writes it; it is schema
--     DRIFT — present in the DB but created by no migration — hence IF EXISTS).
--
-- ROLLBACK: supabase/rollback/20260818000100_credit_note_double_credit_DOWN.sql

-- ── 1. Allow the new terminal status BEFORE any row is written 'reversed' ─────
ALTER TABLE credit_notes DROP CONSTRAINT credit_notes_status_check;
ALTER TABLE credit_notes ADD  CONSTRAINT credit_notes_status_check
  CHECK (status IN ('available', 'applied', 'reversed'));

-- ── 2. Void audit trail (reuse-row would otherwise erase a void's history) ───
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID;

-- ── 3. Dedup historical duplicates BEFORE the unique index (RISK 1) ──────────
-- Keep the OLDEST cash note per invoice_item_id; DELETE younger UNDRAWN
-- duplicates and strip their erroneous credit from the pooled balance. They are
-- DELETED, not marked 'reversed': the reuse design keeps AT MOST ONE row per
-- invoice_item_id TOTAL, so a surviving reversed twin would collide with the
-- non-partial UNIQUE index in step 5 and abort the whole migration. Undrawn dups
-- have no credit_applications, so the DELETE is FK-safe. A DRAWN duplicate is
-- never auto-resolved (its credit already discounted another invoice) — step 4
-- RAISES on one instead of guessing.
--   Production holds 0 credit_notes today, so this is a NO-OP on this deploy; it
--   exists to be correct if a duplicate is ever present when it runs.
DO $$
DECLARE
  v_deleted     NUMERIC := 0;
  v_decremented NUMERIC := 0;
  r             RECORD;
BEGIN
  CREATE TEMP TABLE _dedup_dups ON COMMIT DROP AS
  SELECT id, parent_id, tenant_id, amount FROM (
    SELECT cn.id, cn.parent_id, cn.tenant_id, cn.amount,
           row_number() OVER (PARTITION BY cn.invoice_item_id
                              ORDER BY cn.issued_at, cn.id) AS rn,
           EXISTS (SELECT 1 FROM credit_applications ca
                    WHERE ca.credit_note_id = cn.id) AS drawn
    FROM credit_notes cn
  ) x
  WHERE x.rn > 1 AND NOT x.drawn;

  SELECT COALESCE(SUM(amount), 0) INTO v_deleted FROM _dedup_dups;

  FOR r IN SELECT parent_id, tenant_id, SUM(amount) AS total
             FROM _dedup_dups GROUP BY 1, 2 LOOP
    UPDATE parent_tenant_balances
       SET credit_balance = credit_balance - r.total, updated_at = NOW()
     WHERE parent_id = r.parent_id AND tenant_id = r.tenant_id;
    IF FOUND THEN v_decremented := v_decremented + r.total; END IF;
  END LOOP;

  DELETE FROM credit_notes WHERE id IN (SELECT id FROM _dedup_dups);

  -- RISK 5: every deleted dup's credit MUST have come off a balance row. A
  -- shortfall means a dup's credit lived where the decrement didn't reach (a
  -- missing/mis-keyed balance row) — stop rather than leave phantom credit.
  IF v_deleted <> v_decremented THEN
    RAISE EXCEPTION
      'RISK 5: dedup removed % of duplicate credit but stripped only % from balances; resolve manually',
      v_deleted, v_decremented;
  END IF;
END $$;

-- ── 4. Belt-and-braces: any surviving duplicate is a DRAWN one — refuse ──────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM credit_notes
    GROUP BY invoice_item_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'RISK 1: drawn duplicate credit notes remain for at least one invoice_item_id; '
      'resolve manually before UNIQUE(invoice_item_id) — do NOT auto-dedup a spent credit';
  END IF;
END $$;

-- ── 5. Structural one-note-per-line, and the emails index ────────────────────
CREATE UNIQUE INDEX credit_notes_invoice_item_id_key
  ON credit_notes (invoice_item_id);
CREATE INDEX credit_notes_lesson_session_id_idx
  ON credit_notes (lesson_session_id);

-- ── 6. Drop the vestigial, drifted column (IF EXISTS — no migration made it) ─
ALTER TABLE tenants DROP COLUMN IF EXISTS suspend;

-- ── 7. The symmetric trigger ─────────────────────────────────────────────────
-- ⚠️ handle_attendance_update() has been redefined EIGHT times; this body is
-- carried forward from 20260720000200 (package correction restore), the most
-- recent definition. Confirm before the next edit:
--   grep -ln "FUNCTION handle_attendance_update" supabase/migrations/*.sql | tail -1
-- CREATE OR REPLACE, never DROP (a DROP takes the grants — §8.7, §7.21).
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

    SELECT EXISTS (SELECT 1 FROM credit_applications ca
                    WHERE ca.credit_note_id = v_cn_id)
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
