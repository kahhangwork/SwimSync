-- ============================================================
-- EXPAND: a separate CLAIM column for the two emails that keep sent state,
-- so a send killed between claim and send is retried instead of looking sent.
--
-- Plan: docs/plans/CRASH_SAFE_EMAIL_CLAIM_PLAN.md (Wave 1, lane 2). Before
-- this, invoices.invoice_email_sent_at and credit_notes.email_sent_at were
-- BOTH the claim and the "sent" marker: a sender that died after claiming left
-- a row that rendered "Emailed" and that nothing ever retried.
--
-- After this:
--   * *_sent_at is stamped ONLY after a confirmed send (the edge functions,
--     lane 2's worktree — this migration is dormant until they ship).
--   * *_claimed_at is a 15-minute lease. The lease maths lives HERE, in SQL,
--     never in Deno or the browser (plan §6 risk 1).
--   * email_delivery_state() is the one definition of the five states:
--       SENT           sent_at set
--       UNSENT         never claimed (or a claim was released)  → send now
--       SENDING        claimed < 15 min ago                      → skip
--       RETRYABLE      claimed 15 min – 24 h ago                 → auto-retry, same Idempotency-Key
--       MAY_HAVE_SENT  claimed > 24 h ago                        → NO auto-retry; human Resend only
--     (24 h is Resend's idempotency-key window; decided with the user
--     2026-09-27 — plan §2.)
--
-- ── DEVIATIONS FROM PLAN §3.1, forced by the grant invariants ───────────────
-- The plan said "REVOKE UPDATE on invoices and re-grant a column list" and
-- "a view or RPC" for the state. table_grants.test.sql assertion 6 forbids
-- BOTH a column-level grant to authenticated and any view in public — the
-- invariant is reasoned table by table. So instead:
--   * the email columns are pinned against `authenticated` by extending the
--     existing BEFORE UPDATE trigger pin_invoice_public_fields (the pattern
--     already guarding reference_number / public_token). No app writes either
--     column (grep, 2026-09-27: the only client invoice UPDATE is reminded_at).
--     Roles P11 (coach arm on invoices) is untouched and still open.
--   * the state is exposed as PostgREST COMPUTED COLUMNS —
--     invoice_email_state(invoices), credit_note_email_state(credit_notes) —
--     selectable as `select=*,credit_note_email_state` and filterable. They
--     take the row, so RLS on the table is the read gate; no new grant on data.
--
-- ── RE-ISSUE ────────────────────────────────────────────────────────────────
-- handle_attendance_update re-issues a credit note by UPDATING the same row
-- with a new issued_at and email_sent_at = NULL (two sites, read from the
-- database 2026-09-27, §7.40). A new BEFORE UPDATE trigger clears
-- email_claimed_at (and email_sent_at) whenever issued_at changes, so a
-- re-issued note is UNSENT, and an in-flight sender's conditional settle
-- (… AND email_claimed_at = <its token>) matches nothing.
--
-- ── CLAIM RPCs ──────────────────────────────────────────────────────────────
-- claim_invoice_email / claim_credit_note_email lock the row, compute its
-- state, and claim it only if UNSENT or RETRYABLE — or MAY_HAVE_SENT when
-- p_manual (a human pressed Resend; the caller then uses a NEW key). They
-- return (claimed_at, prior_state): claimed_at is the settle token — every
-- settle UPDATE must be conditional on it. No row returned = not claimed.
-- The claim IS the discovery filter: a caller may list every sent_at IS NULL
-- row and claim each; SENDING and MAY_HAVE_SENT rows simply don't claim.
-- service_role ONLY — both callers are edge functions (§7.87).
--
-- No backfill: NULL is correct for every existing row (§7.171).
--
-- After deploy, dump the REMOTE grants (§7.39):
--   supabase db dump --linked --schema public -f /tmp/d.sql
--   grep -E 'claim_(invoice|credit_note)_email|email_delivery_state|_email_state' /tmp/d.sql | grep -E '"anon"|"authenticated"'
--   # must print only the three state functions' authenticated grants
--
-- Rollback: supabase/rollback/20260927000100_crash_safe_email_claim_DOWN.sql
-- ============================================================

ALTER TABLE public.invoices     ADD COLUMN invoice_email_claimed_at TIMESTAMPTZ NULL;
ALTER TABLE public.credit_notes ADD COLUMN email_claimed_at         TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.invoices.invoice_email_claimed_at IS
  'Email claim lease (15 min; > 24 h = MAY_HAVE_SENT). invoice_email_sent_at is stamped only after a confirmed send. State: invoice_email_state(). 20260927000100.';
COMMENT ON COLUMN public.credit_notes.email_claimed_at IS
  'Email claim lease (15 min; > 24 h = MAY_HAVE_SENT). email_sent_at is stamped only after a confirmed send; cleared on re-issue. State: credit_note_email_state(). 20260927000100.';

-- ── The one definition of the states ────────────────────────────────────────
-- Boundaries: exactly 15 min is RETRYABLE; exactly 24 h is still RETRYABLE.
CREATE OR REPLACE FUNCTION public.email_delivery_state(p_sent_at TIMESTAMPTZ, p_claimed_at TIMESTAMPTZ)
RETURNS TEXT LANGUAGE SQL STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_sent_at IS NOT NULL                          THEN 'SENT'
    WHEN p_claimed_at IS NULL                           THEN 'UNSENT'
    WHEN p_claimed_at >  now() - interval '15 minutes'  THEN 'SENDING'
    WHEN p_claimed_at >= now() - interval '24 hours'    THEN 'RETRYABLE'
    ELSE 'MAY_HAVE_SENT'
  END;
$$;

CREATE OR REPLACE FUNCTION public.invoice_email_state(public.invoices)
RETURNS TEXT LANGUAGE SQL STABLE SET search_path = public AS $$
  SELECT email_delivery_state($1.invoice_email_sent_at, $1.invoice_email_claimed_at);
$$;

CREATE OR REPLACE FUNCTION public.credit_note_email_state(public.credit_notes)
RETURNS TEXT LANGUAGE SQL STABLE SET search_path = public AS $$
  SELECT email_delivery_state($1.email_sent_at, $1.email_claimed_at);
$$;

REVOKE ALL ON FUNCTION public.email_delivery_state(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_email_state(public.invoices)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.credit_note_email_state(public.credit_notes)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_delivery_state(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_email_state(public.invoices)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.credit_note_email_state(public.credit_notes)  TO authenticated, service_role;

COMMENT ON FUNCTION public.email_delivery_state(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'SENT / UNSENT / SENDING (<15 min) / RETRYABLE (15 min–24 h) / MAY_HAVE_SENT (>24 h). The only place the lease is computed. 20260927000100.';
COMMENT ON FUNCTION public.invoice_email_state(public.invoices) IS
  'PostgREST computed column: select=*,invoice_email_state. RLS on invoices is the gate.';
COMMENT ON FUNCTION public.credit_note_email_state(public.credit_notes) IS
  'PostgREST computed column: select=*,credit_note_email_state. RLS on credit_notes is the gate.';

-- ── Claim RPCs (service_role only) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_invoice_email(p_invoice_id UUID, p_manual BOOLEAN DEFAULT FALSE)
RETURNS TABLE (claimed_at TIMESTAMPTZ, prior_state TEXT)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_state TEXT;
BEGIN
  -- The row lock serialises racing claimers: the second one reads the first
  -- one's claim and sees SENDING.
  SELECT email_delivery_state(i.invoice_email_sent_at, i.invoice_email_claimed_at)
    INTO v_state
    FROM invoices i WHERE i.id = p_invoice_id
    FOR UPDATE;

  IF v_state IN ('UNSENT', 'RETRYABLE') OR (p_manual AND v_state = 'MAY_HAVE_SENT') THEN
    UPDATE invoices SET invoice_email_claimed_at = now() WHERE id = p_invoice_id;
    claimed_at := now();
    prior_state := v_state;
    RETURN NEXT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_credit_note_email(p_credit_note_id UUID, p_manual BOOLEAN DEFAULT FALSE)
RETURNS TABLE (claimed_at TIMESTAMPTZ, prior_state TEXT, issued_at TIMESTAMPTZ)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_state  TEXT;
  v_issued TIMESTAMPTZ;
BEGIN
  SELECT email_delivery_state(c.email_sent_at, c.email_claimed_at), c.issued_at
    INTO v_state, v_issued
    FROM credit_notes c WHERE c.id = p_credit_note_id
    FOR UPDATE;

  IF v_state IN ('UNSENT', 'RETRYABLE') OR (p_manual AND v_state = 'MAY_HAVE_SENT') THEN
    UPDATE credit_notes SET email_claimed_at = now() WHERE id = p_credit_note_id;
    claimed_at := now();
    prior_state := v_state;
    issued_at := v_issued;   -- versions the Idempotency-Key: credit-note/<id>/<issued_at epoch>
    RETURN NEXT;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invoice_email(UUID, BOOLEAN)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_credit_note_email(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_invoice_email(UUID, BOOLEAN)     TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_credit_note_email(UUID, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.claim_invoice_email(UUID, BOOLEAN) IS
  'Claim one invoice email (UNSENT/RETRYABLE; MAY_HAVE_SENT only when p_manual). Returns the settle token, or no row. service_role only. 20260927000100.';
COMMENT ON FUNCTION public.claim_credit_note_email(UUID, BOOLEAN) IS
  'Claim one credit-note email (UNSENT/RETRYABLE; MAY_HAVE_SENT only when p_manual). Returns the settle token + issued_at, or no row. service_role only. 20260927000100.';

-- ── Clients cannot write invoice email state ────────────────────────────────
-- Body read from the database 2026-09-27 (§7.40); the first block is unchanged.
CREATE OR REPLACE FUNCTION public.pin_invoice_public_fields()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF (NEW.reference_number IS DISTINCT FROM OLD.reference_number
      OR NEW.public_token IS DISTINCT FROM OLD.public_token)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'invoices.reference_number and public_token are not client-writable — they identify the invoice to banks and to the public page.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.invoice_email_sent_at IS DISTINCT FROM OLD.invoice_email_sent_at
      OR NEW.invoice_email_claimed_at IS DISTINCT FROM OLD.invoice_email_claimed_at)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'invoices.invoice_email_sent_at and invoice_email_claimed_at are not client-writable — only the email sender settles them.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── A re-issued credit note is a new, unsent email ──────────────────────────
CREATE OR REPLACE FUNCTION public.reset_credit_note_email_on_reissue()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.email_claimed_at := NULL;
  NEW.email_sent_at    := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_credit_note_email_on_reissue() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_reset_credit_note_email_on_reissue
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW
  WHEN (NEW.issued_at IS DISTINCT FROM OLD.issued_at)
  EXECUTE FUNCTION public.reset_credit_note_email_on_reissue();
