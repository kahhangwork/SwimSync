-- ============================================================
-- MOVE CREDIT-NOTE DRAWDOWN INTO ONE DATABASE TRANSACTION.
--
-- Until now the billing engine drew credit down in JavaScript across several
-- separate PostgREST statements (core.ts:1425-1508): a lock-free SELECT of
-- 'available' notes, a per-note used-sum, then INSERT credit_applications /
-- flip status / decrement balance — EACH its own transaction. The credit-note
-- trigger took FOR UPDATE on the note in 20260818000100, but a plain read does
-- not block on it, so a coach's un-correction committing 'reversed' + a balance
-- decrement BETWEEN the engine's read and its write produced a double-decrement
-- (balance could go negative) and an invoice discounted by credit the parent no
-- longer held.
--
-- This function is the whole drawdown in ONE transaction. The engine calls it
-- once per invoice via .rpc(); the FOR UPDATE on the balance row and on the
-- notes serialises it against the trigger's FOR UPDATE (20260818000100:263-267)
-- and against Item 3's void.
--
-- ── SELF-CONTAINED ON p_invoice_id ──────────────────────────────────────────
-- parent_id, tenant_id, gross_amount and package_applied are READ FROM the
-- invoice row, not taken as parameters: the invoice is the single source of
-- truth, so the function can never be called with a scope or amount that
-- disagrees with the row it writes.
--
-- ── IDEMPOTENT (RISK 2) ─────────────────────────────────────────────────────
-- The draw + balance decrement + invoice write commit as one transaction. If a
-- LATER engine step ever failed and the run were retried, a second call for the
-- same invoice must NOT draw again. So the FIRST thing under the balance lock is
-- an idempotency check: if this invoice already carries credit_applications, the
-- draw already happened (atomically, in a prior commit) — return the sum and
-- touch nothing. The check sits AFTER the FOR UPDATE deliberately: that lock is
-- what serialises two concurrent calls for the same parent, so the check must be
-- inside it or the second caller reads a stale zero and double-draws.
--
-- ── FOLDS THE INVOICE TRUTH-UP IN (RISK 2) ──────────────────────────────────
-- It writes invoices.credit_applied / net_amount / status ITSELF, in the same
-- transaction as the draw. There is no window where credit is drawn but the
-- invoice still shows the engine's pre-draw ESTIMATE. This also restores the
-- 20260711000100 invariant for free: credit_applied always equals the sum of
-- the invoice's credit_applications.
--
-- SECURITY INVOKER: the engine calls it as service_role, which has the table
-- privileges and bypasses RLS. It is granted to service_role ONLY (below) — the
-- OPPOSITE polarity to 20260806000200's floor functions, which are an
-- authenticated API surface. This is an engine-internal surface.
--
-- NOTE FOR ITEM 3: the void migration does CREATE OR REPLACE on this body to add
-- `AND ca.reversed_at IS NULL` to the two credit_applications sums (the used-sum
-- and the idempotency sum) once that column exists. Signature unchanged.
-- ============================================================

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
  v_cash       NUMERIC(10, 2);   -- gross - package: the most credit can cover
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
  -- The invoice IS the scope and the amounts.
  SELECT parent_id, tenant_id, gross_amount, package_applied
    INTO v_parent_id, v_tenant_id, v_gross, v_package
    FROM invoices
   WHERE id = p_invoice_id;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'apply_credit_to_invoice: invoice % not found', p_invoice_id;
  END IF;

  v_cash := GREATEST(v_gross - v_package, 0);

  -- ── Lock the balance row FIRST (serialises concurrent calls) ──────────────
  -- A parent with no balance row has no credit; the SELECT locks nothing and
  -- v_balance stays NULL → COALESCE to 0. That is safe: with 0 credit nothing
  -- is drawn, so there is no double-draw to serialise against.
  SELECT credit_balance INTO v_balance
    FROM parent_tenant_balances
   WHERE parent_id = v_parent_id AND tenant_id = v_tenant_id
   FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);

  -- ── IDEMPOTENCY (under the lock): a prior call already drew for this invoice
  SELECT COALESCE(SUM(amount), 0) INTO v_existing
    FROM credit_applications
   WHERE invoice_id = p_invoice_id;
  IF v_existing > 0 THEN
    RETURN v_existing;   -- the invoice was already trued up in that same commit
  END IF;

  v_cap := LEAST(v_cash, v_balance);
  v_remaining := v_cap;

  IF v_cap > 0 THEN
    -- ── FIFO over available notes, LOCKED ──────────────────────────────────
    -- ORDER BY issued_at, id: the same order the engine used, and stable. The
    -- FOR UPDATE is what serialises against the trigger and the void.
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

      -- Amount of THIS note already spent on earlier invoices. (Item 3 adds
      -- `AND reversed_at IS NULL` here.)
      SELECT COALESCE(SUM(amount), 0) INTO v_used
        FROM credit_applications
       WHERE credit_note_id = v_note.id;

      v_note_rem := v_note.amount - v_used;

      IF v_note_rem <= 0 THEN
        -- Should not happen for an 'available' note; self-heal the flag and
        -- move on without drawing.
        UPDATE credit_notes SET status = 'applied' WHERE id = v_note.id;
        CONTINUE;
      END IF;

      v_draw := LEAST(v_note_rem, v_remaining);

      INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
        VALUES (v_note.id, p_invoice_id, v_draw);

      -- Flip to 'applied' only once the note is fully consumed; a partial draw
      -- leaves it 'available' with the remainder intact.
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

  -- ── Truth-up the invoice in THIS transaction ──────────────────────────────
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

COMMENT ON FUNCTION public.apply_credit_to_invoice(UUID) IS
  'Draws this parent''s tenant credit down against one invoice FIFO, in ONE transaction: locks the balance row and the notes FOR UPDATE (serialising against the credit-note trigger and the void), is idempotent per invoice (a retry draws nothing), and writes the invoice''s own credit_applied/net_amount/status. Returns the amount actually allocated. Engine-only (service_role).';

-- ── Grants (§7.87/§7.35, both layers) ────────────────────────────────────────
-- Engine-only surface: service_role EXECUTE, nobody else. PUBLIC is its own
-- grantee and must be revoked separately from role grants (§7.35). anon and
-- authenticated get nothing — the opposite polarity to the floor functions,
-- which the coach app calls. Take a REMOTE grant dump after applying (§7.39,
-- §7.89): local and cloud default privileges disagree by construction.
REVOKE ALL     ON FUNCTION public.apply_credit_to_invoice(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_credit_to_invoice(UUID) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_credit_to_invoice(UUID) TO service_role;
