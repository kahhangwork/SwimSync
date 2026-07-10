-- ============================================================
-- Schema updates for invoice generation & credit notes.
-- ============================================================

-- Credit note lifecycle status:
--   'available' = credit ready to be applied to next invoice
--   'applied'   = credit has been used against a specific invoice
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available'
  CHECK (status IN ('available', 'applied'));

-- Sequence for credit note reference numbers (format: CN-YYYY-0001)
CREATE SEQUENCE IF NOT EXISTS credit_note_seq START 1;
