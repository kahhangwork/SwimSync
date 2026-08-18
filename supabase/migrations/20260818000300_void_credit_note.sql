-- ============================================================
-- ADMIN VOID FOR A CREDIT NOTE — CN001's destination (Item 3).
--
-- 20260818000100's un-correction REFUSES (ERRCODE 'CN001') to reverse a credit
-- note whose credit is already spent, because doing so silently reopens a past
-- (possibly paid/sealed) invoice. The refusal is correct and stays. But the
-- recovery it names — "reversed manually" — did not exist: no UI, only hand SQL.
-- This adds the deliberate, audited action that recovery points at.
--
-- Resolved in user review 2026-08-18 (docs/plans/CREDIT_NOTE_AND_MARKABLE_FLOOR_PLAN.md):
--   • the void REOPENS each drawn invoice to 'outstanding'; NO auto-email to the
--     parent in v1 (the admin communicates). paid_at/paid_marked_by/paid_claimed_at
--     are CLEARED on a reopened invoice — an 'outstanding' invoice must not carry
--     settlement stamps (the parent app renders "Paid {paid_at}" independently of
--     status: RISK 4). payment_records rows are LEFT as the immutable history, and
--     confirm_invoice_paid() gates on status='paid', so a re-payment still works.
--   • TENANT ADMINS of the note's own business ONLY — is_tenant_admin(), never
--     can_admin_tenant() (which would let a platform admin void another tenant's
--     note). Same authority the resend path uses.
--
-- The ledger is PERMANENT (20260711000100 doctrine, PRD §5.6): a void MARKS the
-- applications reversed, it never deletes them. `reversed_at`/`reversed_by` are
-- the mark. Every place that sums credit_applications for a "spent" decision now
-- filters `reversed_at IS NULL` (RISK 6): apply_credit_to_invoice's two sums
-- (below), the trigger's spend-signal (below), credit-note-emails' findSpentNoteIds
-- and the admin has_applications embed (app code).
-- ============================================================

-- ── 1. The reversal mark on the ledger ───────────────────────────────────────
ALTER TABLE credit_applications
  ADD COLUMN reversed_at TIMESTAMPTZ,
  ADD COLUMN reversed_by UUID REFERENCES profiles(id);

COMMENT ON COLUMN credit_applications.reversed_at IS
  'When this draw was reversed by a void_credit_note(). NULL = a LIVE draw. The ledger is permanent; a void marks rows reversed rather than deleting them. Every "spent"/"used" sum over credit_applications filters reversed_at IS NULL.';


-- ── 2. void_credit_note() ────────────────────────────────────────────────────
-- SECURITY DEFINER: it writes invoices, credit_applications, credit_notes,
-- parent_tenant_balances and audit_log across a tenant boundary the caller's RLS
-- does not span. Tenant is derived FROM the note row, never a parameter (§7.42),
-- and authorised with is_tenant_admin(v_tenant) — auth.uid() reads the real JWT
-- even under DEFINER, so the seam holds. Granted to authenticated (it self-
-- authorises); nothing to anon/service_role.
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


-- ── 2b. Register 'credit_note' as an audited entity type ─────────────────────
-- set_audit_log_tenant() derives every audit row's tenant from its entity via
-- audit_log_tenant_of() and RAISES on an unknown type (§8.28 / 20260804000300 —
-- a tenant-less audit row is invisible to the business it describes). The void's
-- 'credit_note' rows are new, so add the arm. CREATE OR REPLACE carried forward
-- from 20260813000200 with one WHEN added; DOWN restores that body.
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
    WHEN 'credit_note' THEN
      -- ⟨ITEM 3⟩ void_credit_note() audits under this type. The note is UPDATEd,
      -- never deleted, so it exists at insert time; its own tenant_id is the row.
      SELECT cn.tenant_id INTO v_tenant FROM credit_notes cn WHERE cn.id = p_entity_id;
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


-- ── 3. Trigger v9 — reversed draws are not spend signals; clear on re-activate ─
-- Carried forward VERBATIM from 20260818000100 (§7.115 — confirmed newest body
-- via pg_get_functiondef, not the migration that created it), with EXACTLY two
-- edits, both marked ⟨ITEM 3⟩:
--   A) the spend-signal EXISTS gains `AND ca.reversed_at IS NULL` — a voided draw
--      is not spend, or a voided-then-reactivated note re-trips CN001 forever.
--   B) the re-activation UPDATE also clears applied_to_invoice_id/applied_at.
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


-- ── 4. apply_credit_to_invoice: exclude reversed draws from both sums ─────────
-- CREATE OR REPLACE of the 20260818000200 body with `AND reversed_at IS NULL`
-- added to the idempotency sum AND the per-note used-sum. Signature unchanged, so
-- NO engine redeploy (the engine calls it by name). A voided draw must not count
-- as "already applied to this invoice" (idempotency) nor as "already used" from a
-- note (a re-activated note draws its full amount again).
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


-- ── 5. Grants (§7.87/§7.35, both layers) ─────────────────────────────────────
-- void_credit_note self-authorises, so it is an authenticated surface (the admin
-- calls it). anon/service_role get nothing. Take a REMOTE grant dump after apply
-- (§7.39, §7.89). apply_credit_to_invoice's grants are unchanged by CREATE OR
-- REPLACE, but re-stated here so the whole surface is visible in one file.
REVOKE ALL     ON FUNCTION public.void_credit_note(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_credit_note(UUID, TEXT) FROM anon, service_role;
GRANT  EXECUTE ON FUNCTION public.void_credit_note(UUID, TEXT) TO authenticated;


-- ── 6. Apply-time probes (the pattern 20260804000400 established) ─────────────
DO $$
DECLARE
  v_reversed INT;
  v_defs     INT;
BEGIN
  -- Backfill-free: no application starts life reversed.
  SELECT count(*) INTO v_reversed FROM credit_applications WHERE reversed_at IS NOT NULL;
  IF v_reversed <> 0 THEN
    RAISE EXCEPTION
      'credit_applications has % pre-set reversed_at rows — this migration adds the column, it must start all-NULL', v_reversed;
  END IF;

  -- Exactly one trigger function definition (a stray overload is §7.18).
  SELECT count(*) INTO v_defs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'handle_attendance_update';
  IF v_defs <> 1 THEN
    RAISE EXCEPTION 'handle_attendance_update has % definitions, expected exactly 1', v_defs;
  END IF;
END $$;
