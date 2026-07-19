-- A financial document records the name it was ISSUED with.
--
-- THE BUG THIS CLOSES: invoice_items already snapshots class_title and
-- session_date, but not the student's name — five screens join
-- students(full_name) live (parent invoice, admin invoices, admin credit
-- notes, coach billing, invoice email). So renaming a child silently rewrote
-- their name on invoices that had already been sent, and on credit notes that
-- PRD §7.8 calls "immutable, permanent records".
--
-- It contradicts the rule the codebase already states plainly: A FACT ABOUT A
-- PAST LESSON IS NEVER A LIVE LOOKUP (HANDOVER §6). class_title being
-- snapshotted proves the principle was understood here; the name was simply
-- missed. Same family as reading classes.price_per_lesson at generation time.
--
-- Latent until now because nothing in the app could rename a student. The
-- parent edit-child screen makes it reachable, so this lands before it.
--
-- NULLABLE, deliberately: rows written before this migration genuinely have no
-- snapshot, and inventing one from today's name would be a guess presented as
-- a record — the exact failure being fixed. Readers fall back to the live join
-- for those, which is no worse than today's behaviour and is honest about
-- which rows are authoritative. The backfill below is a best-effort
-- convenience, not a claim about history.

ALTER TABLE invoice_items ADD COLUMN student_name text;
ALTER TABLE credit_notes  ADD COLUMN student_name text;

COMMENT ON COLUMN invoice_items.student_name IS
  'The student''s name AS INVOICED. Snapshot, never re-derived — an invoice '
  'that has been sent must not rewrite itself when a child is renamed. NULL '
  'for rows predating migration 20260719001600.';
COMMENT ON COLUMN credit_notes.student_name IS
  'The student''s name AS CREDITED. Credit notes are immutable records '
  '(PRD §7.8), which a live name join quietly defeated. NULL for rows '
  'predating migration 20260719001600.';

-- Best-effort backfill. These rows are the ONLY ones where the snapshot is a
-- reconstruction rather than a record: no rename has been possible, so today's
-- name is still the name they were issued with. That stops being true the
-- moment the edit screen ships, which is why this runs now and once.
UPDATE invoice_items ii
   SET student_name = s.full_name
  FROM students s
 WHERE s.id = ii.student_id AND ii.student_name IS NULL;

UPDATE credit_notes cn
   SET student_name = s.full_name
  FROM students s
 WHERE s.id = cn.student_id AND cn.student_name IS NULL;

-- Credit notes are immutable to app roles (there is a pgTAP test for it), and
-- this column must be no exception once written.
--
-- The credit-note trigger writes the snapshot from the students row at the
-- moment of issue — see 20260719001700, which replaces handle_attendance_update.
