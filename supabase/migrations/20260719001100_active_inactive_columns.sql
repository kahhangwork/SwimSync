-- ============================================================
-- ACTIVE / INACTIVE — phase 1: columns only, nothing behavioural.
--
-- Additive by design. No RLS change, no policy change, no function change, and
-- nothing reads these yet — phase 2 adds the writers, phase 3 the screens.
--
-- THE MODEL (BACKLOG.md → "Active / inactive status for parents and children"):
--
--   active / inactive     -> is this family / child still a customer OF THIS
--                            BUSINESS? Owned by the business's admin.
--   assigned / unassigned -> is this child in a class right now? Same owner,
--                            different question.
--
-- The two are separate axes on purpose: a new signup is ACTIVE BUT UNASSIGNED,
-- and collapsing that into one field is what makes "inactive" ambiguous today.
-- Phase 6 removes the third spelling by dropping `inactive` from the
-- assignment_status enum.
--
-- WHY PARENT ACTIVITY IS PER BUSINESS, NOT GLOBAL. Parents are deliberately
-- global (no tenant_id) because a family may have one child at a school and
-- another with a private coach — the common case. So "this family has left"
-- can only ever be true OF ONE BUSINESS. Putting the flag on `parents` or on
-- `profiles` would let a school switch a family off at their private coach.
-- Hence parent_tenants, the row that already represents exactly one
-- (family, business) relationship.
--
-- NOT IN THIS ITEM: blocking a login. That is a PLATFORM power over an account
-- (`profiles.is_active`, enforced nowhere today), it is spelled
-- "enabled/disabled" to keep it distinct, and it was cut on 2026-07-19 —
-- see BACKLOG.md → "Disable a staff account".
-- ============================================================

ALTER TABLE parent_tenants
  -- Is this family still a customer of this business? Default TRUE: every
  -- existing row is a family who joined and never left.
  ADD COLUMN is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN inactivated_at TIMESTAMPTZ;

ALTER TABLE students
  -- `students.is_active` already exists. What was missing is WHEN — and the
  -- date is the part that earns its keep: "when did they stop?" is the question
  -- behind every end-of-year reconciliation and every "why is this invoice
  -- short?". Deliberately NOT backfilled for any already-inactive student: we
  -- do not know when they left, and inventing a date from `updated_at` would
  -- put a confident wrong answer into a tax-time record.
  ADD COLUMN inactivated_at TIMESTAMPTZ;

COMMENT ON COLUMN parent_tenants.is_active IS
  'Is this family still a customer of THIS business? Per (parent, tenant) — '
  'parents are global, so a family inactive at one business may be active at '
  'another. Written only by set_parent_tenant_active() / set_student_active() '
  '(phase 2); parent_tenants has no UPDATE policy, so RLS already forbids '
  'direct writes. Not a login block — that is profiles.is_active.';

COMMENT ON COLUMN parent_tenants.inactivated_at IS
  'When this family stopped being a customer of this business. NULL while '
  'active, and NULL for any row that predates this column.';

COMMENT ON COLUMN students.inactivated_at IS
  'When this child stopped attending at their business. NULL while active, and '
  'NULL for children already inactive before 2026-07-19 — that date was never '
  'recorded and is not guessable.';

-- Partial index: every "families at this business" listing filters on active,
-- and inactive rows are the minority that stays small.
CREATE INDEX parent_tenants_active_idx
  ON parent_tenants (tenant_id) WHERE is_active;
