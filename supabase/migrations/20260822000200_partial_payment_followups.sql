-- ============================================================
-- PARTIAL-PAYMENT FOLLOW-UPS (a) + (b) + write-off ramp
-- docs/plans/PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md
-- Builds on 20260822000100 (debit_balance). DORMANT on prod (0 credit notes).
-- Hardened by two /plan-review (fable) passes — RISK/CN tags cite them.
--
-- (a) Re-correcting a voided-and-DEBITED note AUTO-UNWINDS the debit when it is
--     still PENDING (folded_at NULL, written_off_at NULL); keeps CN002 once the
--     debit has been billed (folded) or settled (written off), or when an
--     outstanding-reopen draw is mixed in. "Un-void" is exact: the paid-invoice
--     draws STAND, only the debit posting is undone, the undrawn remainder
--     returns to the pool, and the note goes back to 'available' (has remainder)
--     or 'applied' (fully drawn) — RISK 1/2/8.
-- (b) A new folded_at stamp on credit_applications is what lets us tell PENDING
--     from BILLED exactly (the fold zeroes debit_balance in aggregate, so a bare
--     compare cannot). apply_credit_to_invoice stamps it under the balance lock
--     and asserts the stamped sum equals the consumed debit — RISK 5.
-- Guard: offboarding (is_active true→false) a family with debit_balance > 0 is
--     refused, on a BEFORE UPDATE trigger on parent_tenants so EVERY offboard
--     path inherits it (set_students_active's consequence rule bypasses a
--     per-RPC guard) — RISK 3. DEBIT ONLY — credit is preserved across offboard.
-- Ramp: write_off_parent_balance() zeroes a pending debit (audited,
--     reconciliation-safe) so a leaver can be offboarded; money, if owed, is
--     settled out-of-band. SECURITY DEFINER on the void_credit_note template.
--
-- Engine UNCHANGED (the fold is all in-SQL; core.ts only invokes the RPC).
-- write_off_parent_balance is a NEW SECURITY DEFINER function ⇒ take a REMOTE
-- grant dump after apply (§7.39, §7.89).
-- ============================================================

-- ── 1. Schema ────────────────────────────────────────────────────────────────
ALTER TABLE credit_applications
  ADD COLUMN folded_at         TIMESTAMPTZ,
  ADD COLUMN folded_invoice_id UUID REFERENCES invoices(id),
  ADD COLUMN written_off_at    TIMESTAMPTZ,
  ADD COLUMN written_off_by    UUID REFERENCES profiles(id);

COMMENT ON COLUMN credit_applications.folded_at IS
  'Set when apply_credit_to_invoice consumed THIS debited draw onto an invoice (folded_invoice_id). A debited draw is PENDING iff folded_at IS NULL AND written_off_at IS NULL; once folded it has been billed and a re-correction is refused (CN002). Reconciliation: debit_balance = Σ(amount) over debited_at NOT NULL AND folded_at NULL AND written_off_at NULL.';
COMMENT ON COLUMN credit_applications.written_off_at IS
  'Set when write_off_parent_balance cleared THIS pending debited draw. Spent-and-closed: it never funds a debit, a fold, or an auto-unwind again, and it drops out of the reconciliation sum (mirror of folded_at).';

-- ── 2. apply_credit_to_invoice() — stamp folded_at + reconcile (RISK 5) ──────
-- Carried forward from 20260822000100. ⟨FOLLOWUP⟩ edit: when a debit is folded,
-- stamp the debited-pending draws it consumed and RAISE unless their sum equals
-- the consumed debit. The stamp runs AFTER the parent_tenant_balances FOR UPDATE
-- already held above — the void↔fold race is safe only under that lock (a void
-- marking debited_at cannot commit without its own balance UPDATE blocking here).
-- Signature unchanged, SECURITY INVOKER (engine is service_role). CREATE OR REPLACE.
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
  v_adj        NUMERIC(10, 2);
  v_cash       NUMERIC(10, 2);
  v_balance    NUMERIC(10, 2);
  v_debit      NUMERIC(10, 2);
  v_folded     NUMERIC(10, 2);   -- ⟨FOLLOWUP⟩ stamped sum, for the reconciliation
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

  -- ⟨DEBIT⟩ consume the folded debit (row locked; this zeroes it), and
  -- ⟨FOLLOWUP / RISK 5⟩ stamp the debited-pending draws it consumed. The stamped
  -- sum MUST equal the consumed debit, or the folded/pending invariant has drifted.
  IF v_debit > 0 THEN
    UPDATE parent_tenant_balances
       SET debit_balance = debit_balance - v_debit, updated_at = NOW()
     WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id;

    WITH stamped AS (
      UPDATE credit_applications ca
         SET folded_at = NOW(), folded_invoice_id = p_invoice_id
        FROM credit_notes cn
       WHERE ca.credit_note_id = cn.id
         AND cn.parent_id      = v_parent_id
         AND cn.tenant_id      = v_tenant_id
         AND ca.debited_at     IS NOT NULL
         AND ca.folded_at      IS NULL
         AND ca.written_off_at IS NULL
      RETURNING ca.amount
    )
    SELECT COALESCE(SUM(amount), 0) INTO v_folded FROM stamped;

    -- Reconcile the stamped rows against the consumed debit. A debit with NO
    -- traceable debited draws (v_folded = 0) is benign HERE — there is no row a
    -- later re-correction could wrongly unwind (the auto-unwind requires a debited
    -- draw to exist) — so the fold bills it and moves on. (write_off_parent_balance
    -- is deliberately STRICTER on the same state: it RAISES rather than zeroing a
    -- zero-trace debit, so an untraceable debit surfaces for investigation instead
    -- of being silently forgiven. The two are consistent: bill-and-carry is safe,
    -- forgive-without-trace is not.) But once draws exist their sum MUST equal the
    -- debit, BOTH directions: an over-stamp brands a row billed that was not
    -- covered, an under-stamp would leave real debit untraced (RISK 5).
    IF v_folded > 0 AND v_folded <> v_debit THEN
      RAISE EXCEPTION
        'debit fold reconciliation failed: stamped % but consumed % (folded/pending invariant drift)',
        v_folded, v_debit;
    END IF;
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
  'Settles ONE invoice against the parent''s tenant account in ONE locked transaction: folds any pending debit_balance (balance_adjustment, cash base = gross − package + debit), draws pooled credit FIFO against that debit-inclusive base, consumes both balances, STAMPS the folded debited draws (folded_at, reconciled against the consumed debit), and writes credit_applied/balance_adjustment/net_amount/status. Idempotent per invoice. Engine-only (service_role).';

-- ── 3. handle_attendance_update() — AUTO-UNWIND a pending debited note (a) ────
-- Carried forward VERBATIM from 20260822000100, with the CN002 block replaced by
-- the auto-unwind-vs-CN002 decision. All ⟨FOLLOWUP⟩. CREATE OR REPLACE.
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
  v_cn_amount     NUMERIC;   -- ⟨FOLLOWUP⟩ the note's own amount
  v_cn_applied_inv UUID;
  v_cn_drawn      BOOLEAN;
  v_drawn_sum     NUMERIC;   -- ⟨FOLLOWUP⟩ sum of the debited-pending draws
  v_remainder     NUMERIC;   -- ⟨FOLLOWUP⟩ undrawn remainder returning to the pool
  v_paid_inv      UUID;      -- ⟨FOLLOWUP⟩ a live draw's invoice, for a re-applied note
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

    -- FOR UPDATE (RISK 5 / lock): serialise against void_credit_note, which locks
    -- the note first — so a void cannot race this re-correction.
    SELECT id, status, amount INTO v_cn_id, v_cn_status, v_cn_amount
    FROM credit_notes WHERE invoice_item_id = v_item_id
    FOR UPDATE;

    IF v_cn_id IS NOT NULL THEN
      IF v_cn_status = 'reversed' THEN
        -- ⟨FOLLOWUP a⟩ A note voided-and-recovered as a debit: AUTO-UNWIND when the
        -- void is still fully reversible (every draw debited + PENDING), else CN002.
        IF EXISTS (SELECT 1 FROM credit_applications
                    WHERE credit_note_id = v_cn_id AND debited_at IS NOT NULL) THEN

          -- ⟨RISK 5 / lock — MANDATORY⟩ Take the balance row FOR UPDATE BEFORE any
          -- read below. Without it a concurrent fold (apply_credit_to_invoice, i.e.
          -- a billing run) or write_off can commit BETWEEN the reversibility check
          -- and the drawn-sum read: the guard passes on the pre-commit snapshot,
          -- the SUM reads 0 on the post-commit snapshot, and the note is re-credited
          -- IN FULL against a charge already billed/settled — a silent double refund.
          -- This lock serialises against apply's and write_off's own balance locks.
          PERFORM 1 FROM parent_tenant_balances
           WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id
           FOR UPDATE;

          -- Not fully reversible if ANY draw is folded (billed), written off, or is
          -- anything other than a debited-pending draw (an outstanding-reopen or a
          -- live never-debited draw — debited_at IS NULL). Keep CN002.
          IF EXISTS (
            SELECT 1 FROM credit_applications
             WHERE credit_note_id = v_cn_id
               AND (folded_at IS NOT NULL OR written_off_at IS NOT NULL OR debited_at IS NULL)
          ) THEN
            RAISE EXCEPTION
              'credit note % was voided and its charge has already been billed or settled; that charge must be reversed before this lesson can be re-corrected',
              v_cn_id USING ERRCODE = 'CN002';
          END IF;

          -- Fully reversible → un-void exactly. RISK 2: subtract the DRAWN sum,
          -- NEVER the note amount.
          SELECT COALESCE(SUM(amount), 0) INTO v_drawn_sum
            FROM credit_applications
           WHERE credit_note_id = v_cn_id
             AND debited_at IS NOT NULL AND folded_at IS NULL AND written_off_at IS NULL;

          -- 1. undo the debit posting
          UPDATE parent_tenant_balances
             SET debit_balance = debit_balance - v_drawn_sum, updated_at = NOW()
           WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id;

          -- 2. the draws become ordinary live draws again (they STAND on their
          --    paid invoices — that is why the note is 'applied', not re-credited).
          --    Clear ONLY the pending draws (RISK 5 belt: never a folded/written one).
          UPDATE credit_applications
             SET debited_at = NULL, debited_by = NULL
           WHERE credit_note_id = v_cn_id
             AND debited_at IS NOT NULL AND folded_at IS NULL AND written_off_at IS NULL;

          -- 3. the undrawn remainder returns to the pool
          v_remainder := v_cn_amount - v_drawn_sum;
          IF v_remainder > 0 THEN
            INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
            VALUES (v_parent_id, v_tenant_id, v_remainder)
            ON CONFLICT (parent_id, tenant_id) DO UPDATE
              SET credit_balance = parent_tenant_balances.credit_balance + EXCLUDED.credit_balance,
                  updated_at = NOW();
          END IF;

          -- 4. restore the note. RISK 1: a partially-drawn note goes back to
          --    'available' or its remainder is unspendable. RISK 8: a fully-drawn
          --    note gets its applied_to_invoice_id / applied_at back.
          SELECT invoice_id INTO v_paid_inv
            FROM credit_applications
           WHERE credit_note_id = v_cn_id AND reversed_at IS NULL
           ORDER BY applied_at DESC NULLS LAST
           LIMIT 1;

          UPDATE credit_notes
             SET status                = CASE WHEN v_remainder > 0 THEN 'available' ELSE 'applied' END,
                 original_status       = OLD.status,
                 corrected_status      = NEW.status,
                 reason                = NEW.edit_reason,
                 issued_at             = NOW(),
                 reversed_at           = NULL,
                 reversed_by           = NULL,
                 email_sent_at         = NULL,
                 applied_to_invoice_id = CASE WHEN v_remainder > 0 THEN NULL ELSE v_paid_inv END,
                 applied_at            = CASE WHEN v_remainder > 0 THEN NULL ELSE NOW() END
           WHERE id = v_cn_id;

          RETURN NEW;
        END IF;

        -- (not debited) — the existing re-activation, unchanged.
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

-- ── 4. Offboard guard — a family owing a debit cannot be deactivated (RISK 3) ─
-- On parent_tenants directly, so EVERY offboard path inherits it:
-- set_parent_tenant_active's own UPDATE, set_students_active's "no active
-- children left ⇒ family inactive" consequence rule, and close_student_enrolment
-- which delegates to it. DEBIT ONLY — credit is deliberately preserved across
-- offboard (a returning family keeps it). SECURITY DEFINER so the balance read
-- is not subject to the caller's RLS.
CREATE OR REPLACE FUNCTION public.guard_parent_offboard_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debit NUMERIC(10, 2);
BEGIN
  -- FOR UPDATE: block until any in-flight void's balance UPDATE commits, so a debit
  -- posted concurrently cannot slip a family offboard while they still owe (TOCTOU).
  SELECT debit_balance INTO v_debit
    FROM parent_tenant_balances
   WHERE parent_id = NEW.parent_id AND tenant_id = NEW.tenant_id
   FOR UPDATE;

  IF COALESCE(v_debit, 0) > 0 THEN
    RAISE EXCEPTION
      'this family has an unbilled charge of % owing; write it off or settle it before offboarding',
      v_debit USING ERRCODE = 'OFB01';
  END IF;

  RETURN NEW;
END;
$$;

-- WHEN scopes it to the offboard transition only — reactivation and other
-- updates never fire it.
DROP TRIGGER IF EXISTS trg_guard_parent_offboard ON parent_tenants;
CREATE TRIGGER trg_guard_parent_offboard
  BEFORE UPDATE ON parent_tenants
  FOR EACH ROW
  WHEN (OLD.is_active = TRUE AND NEW.is_active = FALSE)
  EXECUTE FUNCTION guard_parent_offboard_balance();

-- ── 5. write_off_parent_balance() — the guard's exit ramp (2b) ────────────────
-- Admin-only. Zeroes a parent's pending debit_balance, stamping written_off_at on
-- the contributing debited-pending draws (reconciliation-safe), and asserts the
-- stamped sum equals the balance. Touches debit_balance + written_off_at ONLY —
-- never an invoice, a credit note, or credit_balance. Money, if owed, is settled
-- out-of-band. SECURITY DEFINER on the void_credit_note template (authenticated
-- cannot write these rows itself).
CREATE OR REPLACE FUNCTION public.write_off_parent_balance(
  p_parent_id UUID,
  p_tenant_id UUID,
  p_reason    TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_debit   NUMERIC(10, 2);
  v_stamped NUMERIC(10, 2);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to write off a balance';
  END IF;

  IF NOT is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may write off a balance';
  END IF;

  SELECT debit_balance INTO v_debit
    FROM parent_tenant_balances
   WHERE parent_id = p_parent_id AND tenant_id = p_tenant_id
   FOR UPDATE;

  -- CN-R3: refuse on absent row too, not only on 0.
  IF v_debit IS NULL OR v_debit = 0 THEN
    RAISE EXCEPTION 'this family has nothing to write off';
  END IF;

  WITH woff AS (
    UPDATE credit_applications ca
       SET written_off_at = NOW(), written_off_by = v_actor
      FROM credit_notes cn
     WHERE ca.credit_note_id = cn.id
       AND cn.parent_id      = p_parent_id
       AND cn.tenant_id      = p_tenant_id
       AND ca.debited_at     IS NOT NULL
       AND ca.folded_at      IS NULL
       AND ca.written_off_at IS NULL
    RETURNING ca.amount
  )
  SELECT COALESCE(SUM(amount), 0) INTO v_stamped FROM woff;

  IF v_stamped <> v_debit THEN
    RAISE EXCEPTION
      'write-off reconciliation failed: stamped % but debit_balance is % (invariant drift)',
      v_stamped, v_debit;
  END IF;

  UPDATE parent_tenant_balances
     SET debit_balance = 0, updated_at = NOW()
   WHERE parent_id = p_parent_id AND tenant_id = p_tenant_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, tenant_id, new_value)
  VALUES (
    v_actor, 'parent_debit_written_off', 'ParentTenant', p_parent_id, p_tenant_id,
    jsonb_build_object('reason', btrim(p_reason), 'amount', v_debit)
  );

  RETURN v_debit;
END;
$$;

COMMENT ON FUNCTION public.write_off_parent_balance(UUID, UUID, TEXT) IS
  'Tenant-admin action to clear a parent''s pending debit_balance so a leaver can be offboarded — the guard''s exit ramp. Stamps written_off_at on the contributing debited-pending draws (reconciliation-safe) and asserts their sum equals the balance, then zeroes it. Touches debit_balance + written_off_at ONLY; never an invoice, a credit note, or credit_balance. Money owed is settled out-of-band. Audited. Authority: is_tenant_admin of the parent''s own business.';

REVOKE ALL     ON FUNCTION public.write_off_parent_balance(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.write_off_parent_balance(UUID, UUID, TEXT) FROM anon, service_role;
GRANT  EXECUTE ON FUNCTION public.write_off_parent_balance(UUID, UUID, TEXT) TO authenticated;

-- ── 6. Apply-time reconciliation probe (RISK 5, belt-and-braces) ─────────────
-- 20260822000100 already asserted debit_balance all-0 at its apply; nothing runs
-- between, so this is trivially satisfied on prod/fresh state. It fails loudly if
-- a stale dev DB carries a debit that does not trace to a debited-pending draw.
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
    FROM parent_tenant_balances ptb
   WHERE ptb.debit_balance <> COALESCE((
     SELECT SUM(ca.amount)
       FROM credit_applications ca
       JOIN credit_notes cn ON cn.id = ca.credit_note_id
      WHERE cn.parent_id      = ptb.parent_id
        AND cn.tenant_id      = ptb.tenant_id
        AND ca.debited_at     IS NOT NULL
        AND ca.folded_at      IS NULL
        AND ca.written_off_at IS NULL
   ), 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'debit_balance reconciliation failed for % (parent,tenant) rows at migration apply', v_bad;
  END IF;
END;
$$;
