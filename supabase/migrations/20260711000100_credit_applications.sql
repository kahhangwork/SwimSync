-- ============================================================
-- Credit Applications — allocation ledger for credit notes.
--
-- PROBLEM THIS FIXES
-- Credit is pooled per parent in `parents.credit_balance` and spent
-- against the parent's single monthly invoice. Previously the only
-- per-note record of spending was `credit_notes.status`
-- (available | applied) plus `applied_to_invoice_id`. That coarse flag
-- cannot represent PARTIAL consumption: when a $30 credit note covered
-- a $20 invoice, the whole note was flagged `applied` and the residual
-- $10 lived only in the pooled balance with no note backing it. The
-- note ledger then no longer reconciled with invoice `credit_applied`
-- (PRD §7.8 audit trail, §11.7 carry-forward).
--
-- SOLUTION
-- Record every draw as its own immutable row here. Each row is a
-- partial (or full) application of one credit note against one invoice.
-- Invariants the invoice engine maintains going forward:
--   • SUM(credit_applications.amount WHERE invoice_id = X)
--       = invoices.credit_applied for X
--   • SUM(credit_applications.amount WHERE credit_note_id = N)
--       <= credit_notes.amount for N        (remaining = amount - sum)
--   • parents.credit_balance = SUM of remaining across the parent's notes
--
-- A credit note may now be drawn down across MULTIPLE invoices/months.
-- `credit_notes.status` becomes derived: it stays `available` until the
-- note is fully consumed, then flips to `applied`. `applied_to_invoice_id`
-- / `applied_at` now mean "the invoice/time that FULLY consumed the note";
-- the per-invoice breakdown lives in this table.
--
-- Credit remains owned at the PARENT level (via the note's parent_id),
-- so a credit earned from one child is spendable against any child's
-- charges on the parent's combined invoice — this table does not change
-- that.
-- ============================================================

CREATE TABLE credit_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id  UUID NOT NULL REFERENCES credit_notes(id),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount          NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX credit_applications_note_idx    ON credit_applications (credit_note_id);
CREATE INDEX credit_applications_invoice_idx ON credit_applications (invoice_id);

-- ------------------------------------------------------------
-- Backfill from historical state.
-- Every credit note already marked `applied` recorded a single full
-- application against `applied_to_invoice_id`. Reconstruct that as one
-- ledger row so history is preserved. (Legacy rows may reflect the old
-- full-consumption behaviour; going forward the engine writes true
-- partial amounts.)
-- ------------------------------------------------------------
INSERT INTO credit_applications (credit_note_id, invoice_id, amount, applied_at)
SELECT cn.id, cn.applied_to_invoice_id, cn.amount,
       COALESCE(cn.applied_at, cn.issued_at)
FROM credit_notes cn
WHERE cn.status = 'applied'
  AND cn.applied_to_invoice_id IS NOT NULL;

-- ------------------------------------------------------------
-- RLS: read-only for app roles, mirroring credit_notes.
-- Only the invoice engine (service_role, bypasses RLS) writes here, so
-- there is no INSERT/UPDATE/DELETE policy — the ledger is immutable to
-- app users. A row is visible to whoever may see its parent credit note.
-- ------------------------------------------------------------
ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_applications_select ON credit_applications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM credit_notes cn
      WHERE cn.id = credit_applications.credit_note_id
        AND (
          cn.parent_id = current_parent_id()
          OR is_superadmin()
          OR coach_serves_parent(cn.parent_id)
        )
    )
  );

-- ------------------------------------------------------------
-- Grants. Objects created by the `postgres` migration role are covered
-- by the ALTER DEFAULT PRIVILEGES set in 20260309000800_grants.sql, but
-- grant explicitly too so this migration is self-contained.
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON credit_applications
  TO authenticated, service_role;
