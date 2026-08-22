-- ============================================================
-- PARTIAL-PAYMENT VIA A SIGNED ACCOUNT POSITION (debit_balance)
-- docs/plans/PARTIAL_PAYMENT_PLAN.md — the Wave D "voided-credit reopen" trap.
--
-- Problem: void_credit_note() reopened a drawn invoice (net_amount += amount).
-- On an already-PAID invoice that overstated the amount owed — payment_records
-- shows the old lower payment, net jumps back up, and the admin reconciles by
-- hand. Root cause: paid invoices were being MUTATED, and there is no amount-owed
-- model.
--
-- Fix (immutable paid invoices + one net account position, both directions):
--   • credit_balance (we owe the parent) already exists and the engine already
--     offsets the next invoice with it. This adds its mirror, debit_balance (the
--     parent owes us), as a SEPARATE column — NOT a signed credit_balance, which
--     is welded to the credit-note ledger (apply's sums, the trigger's spend
--     signals, the void's undrawn math) and would desync if it went negative.
--   • A void against a PAID invoice no longer reopens it. It marks the draw
--     reversed_at + debited_at (the discount on the paid invoice STANDS — history)
--     and adds the drawn amount to debit_balance. A void against an OUTSTANDING
--     invoice keeps the existing reopen.
--   • credit and debit COEXIST and NET at invoice-application time, never in the
--     balance (netting in the balance would decrement credit_balance outside the
--     ledger). apply_credit_to_invoice is extended: cash base = (gross − package)
--     + debit, credit draws FIFO against that, debit_balance is consumed, and the
--     invoice records balance_adjustment = debit, net_amount = cash − credit.
--
-- Reviewed by /plan-review (fable). This migration is items 1–4 of the plan.
-- Grants: void_credit_note stays authenticated-only; apply_credit_to_invoice's
-- signature is UNCHANGED (engine calls it by name — no redeploy forced, but the
-- engine IS being updated to also call it when only a debit is pending). Take a
-- REMOTE grant dump after apply (§7.39, §7.89).
-- ============================================================

-- ── 1. Schema ────────────────────────────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN balance_adjustment NUMERIC(10, 2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN invoices.balance_adjustment IS
  'A prior-period DEBIT (parent_tenant_balances.debit_balance) folded onto THIS invoice at generation, by apply_credit_to_invoice. net_amount = gross_amount − package_applied − credit_applied + balance_adjustment. Written EXACTLY ONCE, at settle time; never onto an existing invoice (a future "collect now" feature must honour that).';

ALTER TABLE parent_tenant_balances
  ADD COLUMN debit_balance NUMERIC(10, 2) NOT NULL DEFAULT 0
    CHECK (debit_balance >= 0);
COMMENT ON COLUMN parent_tenant_balances.debit_balance IS
  'What the parent OWES from a post-payment correction (a void of a credit that had been drawn against an already-paid invoice). The mirror of credit_balance. Non-negative by construction: voids only ADD to it, the engine only SUBTRACTS when folding it onto the next invoice. Net account position = credit_balance − debit_balance.';

ALTER TABLE credit_applications
  ADD COLUMN debited_at TIMESTAMPTZ,
  ADD COLUMN debited_by UUID REFERENCES profiles(id);
COMMENT ON COLUMN credit_applications.debited_at IS
  'Set (alongside reversed_at) when a void recovered THIS draw as a debit_balance charge instead of reopening its invoice — i.e. the draw was against a PAID invoice. The void loop skips debited_at IS NOT NULL rows, so a re-void never double-charges. Every debit_balance increment traces to a debited_at row (reconciliation).';


-- ── 2. void_credit_note() — paid draws become a debit, never a reopen ────────
-- Carried forward from 20260818000300 (§7.115 — this is the newest body). Edits,
-- all marked ⟨DEBIT⟩: the loop skips already-debited draws; a paid invoice's draw
-- is recovered as a debit rather than reopened; the debit total lands on
-- debit_balance. The credit_balance ≥ 0 guard is KEPT (it is still a real
-- corruption signal for the pool). CREATE OR REPLACE, never DROP (keeps grants).
CREATE OR REPLACE FUNCTION public.void_credit_note(p_note_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_tenant     UUID;
  v_parent     UUID;
  v_amount     NUMERIC(10, 2);
  v_status     TEXT;
  v_ref        TEXT;
  v_drawn      NUMERIC(10, 2) := 0;
  v_debited    NUMERIC(10, 2) := 0;   -- ⟨DEBIT⟩ paid draws recovered as debit
  v_undrawn    NUMERIC(10, 2);
  v_new_bal    NUMERIC(10, 2);
  v_app        RECORD;
  v_inv_status TEXT;                  -- ⟨DEBIT⟩ paid vs outstanding per draw
  v_reopened   JSONB := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to void a credit note';
  END IF;

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

  -- ── Unwind each un-recovered LIVE draw ─────────────────────────────────────
  -- ⟨DEBIT⟩ skip draws already recovered as a debit (debited_at) so a re-void of
  -- a re-activated note cannot charge the same draw twice.
  FOR v_app IN
    SELECT id, invoice_id, amount
      FROM credit_applications
     WHERE credit_note_id = p_note_id
       AND reversed_at IS NULL
       AND debited_at  IS NULL
     FOR UPDATE
  LOOP
    -- Lock the invoice to serialise against confirm_invoice_paid().
    SELECT status INTO v_inv_status
      FROM invoices WHERE id = v_app.invoice_id FOR UPDATE;

    IF v_inv_status = 'paid' THEN
      -- ⟨DEBIT⟩ Paid invoice is immutable: its discount STANDS (credit_applied and
      -- net_amount stay as history). Recover the drawn value as a debit on the
      -- account. Mark debited_at ONLY, never reversed_at — the draw is NOT undone,
      -- so credit_applied still reconciles with its non-reversed applications
      -- (RISK 6). The debited_at guard alone stops a re-void from double-charging.
      UPDATE credit_applications
         SET debited_at = NOW(), debited_by = v_actor
       WHERE id = v_app.id;
      v_debited := v_debited + v_app.amount;
    ELSE
      -- Outstanding invoice: reopen it (existing behaviour).
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
      v_reopened := v_reopened
        || jsonb_build_object('invoice_id', v_app.invoice_id, 'amount', v_app.amount);
    END IF;

    v_drawn := v_drawn + v_app.amount;
  END LOOP;

  v_undrawn := v_amount - v_drawn;

  UPDATE credit_notes
     SET status                = 'reversed',
         reversed_at           = NOW(),
         reversed_by           = v_actor,
         applied_to_invoice_id = NULL,
         applied_at            = NULL
   WHERE id = p_note_id;

  -- Pool: remove the undrawn remainder only (unchanged). The reopened draws
  -- return to the tenant as the invoices' increased net; the debited draws are
  -- recovered via debit_balance below — neither returns to the pool.
  IF v_undrawn <> 0 THEN
    UPDATE parent_tenant_balances
       SET credit_balance = credit_balance - v_undrawn, updated_at = NOW()
     WHERE parent_id = v_parent AND tenant_id = v_tenant;
  END IF;

  -- ⟨DEBIT⟩ post the paid-draw total as a debit the next invoice will collect.
  IF v_debited > 0 THEN
    INSERT INTO parent_tenant_balances (parent_id, tenant_id, debit_balance)
    VALUES (v_parent, v_tenant, v_debited)
    ON CONFLICT (parent_id, tenant_id) DO UPDATE
      SET debit_balance = parent_tenant_balances.debit_balance + EXCLUDED.debit_balance,
          updated_at = NOW();
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
      'debit_posted', v_debited,
      'undrawn_removed', v_undrawn,
      'invoices_reopened', v_reopened
    )
  );
END;
$$;

COMMENT ON FUNCTION public.void_credit_note(UUID, TEXT) IS
  'Tenant-admin action to void a credit note. A draw against an OUTSTANDING invoice reopens it (net += amount, settlement stamps cleared, application reversed_at). A draw against a PAID invoice is NOT reopened — the invoice is immutable; the drawn value is recovered onto parent_tenant_balances.debit_balance and the application is marked reversed_at + debited_at, so a re-void never double-charges. The undrawn remainder leaves the pool. Keeps the credit_balance ≥ 0 guard. No parent email in v1. Authority: is_tenant_admin of the note''s own business only.';


-- ── 2c. handle_attendance_update() — refuse re-correcting a DEBITED note ─────
-- Carried forward VERBATIM from 20260818000300 (§7.115), with ONE edit marked
-- ⟨DEBIT⟩: re-correcting (present→absent) a note that was voided and recovered as
-- a debit would need the full multi-flip debit state machine (double-credit /
-- desync traps in every naive form). v1 REFUSES it (CN002), the symmetric mirror
-- of CN001 — safe, no silent misbill. Follow-up: BACKLOG "Partial-payment: seamless
-- re-correction of a debited note". CREATE OR REPLACE, never DROP (keeps grants).
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

  -- ══ CORRECTION: billable → non-billable ═══════════════════════════════════
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
        -- ⟨DEBIT⟩ A note voided-and-recovered as a debit cannot be re-activated in
        -- v1 — reversing the debit while its invoice discount is frozen history is
        -- the multi-flip state machine we deferred. Refuse, mirror of CN001.
        IF EXISTS (SELECT 1 FROM credit_applications
                    WHERE credit_note_id = v_cn_id AND debited_at IS NOT NULL) THEN
          RAISE EXCEPTION
            'credit note % was voided and recovered as an account charge; that charge must be settled or reversed before this lesson can be re-corrected',
            v_cn_id USING ERRCODE = 'CN002';
        END IF;

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

  -- ══ UN-CORRECTION: non-billable → billable ════════════════════════════════
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
                    WHERE ca.credit_note_id = v_cn_id
                      AND ca.reversed_at IS NULL)
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


-- ── 3. apply_credit_to_invoice() — fold + net the debit, draw credit ─────────
-- Extends 20260818000300's body. ⟨DEBIT⟩ edits: read debit_balance under the same
-- lock; cash base includes the debit; consume the debit; write balance_adjustment.
-- Idempotent under the lock (balance_adjustment already set OR a live draw exists
-- ⇒ already settled). Signature unchanged. SECURITY INVOKER (engine is service_role).
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
  v_adj        NUMERIC(10, 2);   -- ⟨DEBIT⟩ existing balance_adjustment (idempotency)
  v_cash       NUMERIC(10, 2);
  v_balance    NUMERIC(10, 2);
  v_debit      NUMERIC(10, 2);   -- ⟨DEBIT⟩ pending debit to fold
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
  SELECT parent_id, tenant_id, gross_amount, package_applied, balance_adjustment
    INTO v_parent_id, v_tenant_id, v_gross, v_package, v_adj
    FROM invoices
   WHERE id = p_invoice_id;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'apply_credit_to_invoice: invoice % not found', p_invoice_id;
  END IF;

  -- Idempotency (§7.17 retry): a prior call already settled this invoice.
  -- ⟨DEBIT⟩ a set balance_adjustment is also "already settled" — never re-fold.
  SELECT COALESCE(SUM(amount), 0) INTO v_existing
    FROM credit_applications
   WHERE invoice_id = p_invoice_id AND reversed_at IS NULL;
  IF v_adj <> 0 OR v_existing > 0 THEN
    RETURN v_existing;
  END IF;

  SELECT credit_balance, debit_balance INTO v_balance, v_debit
    FROM parent_tenant_balances
   WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id
   FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  v_debit   := COALESCE(v_debit, 0);

  -- ⟨DEBIT⟩ the debit adds to what this invoice must collect; credit draws
  -- against the debit-inclusive base, so credit and debit net on the bill.
  v_cash := GREATEST(v_gross - v_package, 0) + v_debit;

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

  -- ⟨DEBIT⟩ consume the folded debit (row is locked; this zeroes it).
  IF v_debit > 0 THEN
    UPDATE parent_tenant_balances
       SET debit_balance = debit_balance - v_debit, updated_at = NOW()
     WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id;
  END IF;

  v_net := v_cash - v_allocated;
  UPDATE invoices
     SET credit_applied     = v_allocated,
         balance_adjustment = v_debit,
         net_amount         = v_net,
         status             = CASE WHEN v_net = 0 THEN 'paid'::invoice_status
                                   ELSE 'outstanding'::invoice_status END
   WHERE id = p_invoice_id;

  RETURN v_allocated;
END;
$$;

COMMENT ON FUNCTION public.apply_credit_to_invoice(UUID) IS
  'Settles ONE invoice against the parent''s tenant account, in ONE locked transaction: folds any pending debit_balance onto it (balance_adjustment, cash base = gross − package + debit), draws pooled credit FIFO against that debit-inclusive base, consumes both balances, and writes credit_applied/balance_adjustment/net_amount/status. Idempotent per invoice (a set balance_adjustment or a live draw ⇒ returns). Engine-only (service_role); the name is historical — it now settles both directions.';


-- ── 4. Apply-time probes (the 20260804000400 pattern) ────────────────────────
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM invoices WHERE balance_adjustment <> 0;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'invoices has % rows with a non-zero balance_adjustment — this migration adds the column, it must start all-0', v_bad;
  END IF;
  SELECT count(*) INTO v_bad FROM parent_tenant_balances WHERE debit_balance <> 0;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'parent_tenant_balances has % rows with a non-zero debit_balance — must start all-0', v_bad;
  END IF;
  SELECT count(*) INTO v_bad FROM credit_applications WHERE debited_at IS NOT NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'credit_applications has % pre-set debited_at rows — must start all-NULL', v_bad;
  END IF;
END $$;
