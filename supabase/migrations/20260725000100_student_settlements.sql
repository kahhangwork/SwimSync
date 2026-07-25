-- ============================================================
-- Trial & provisional student onboarding, phase 1 (TRIAL_ONBOARDING_PLAN.md).
--
-- A child can now exist on the roster before their parent has an account: the
-- coach adds a trial walk-in at the poolside, or an existing student whose
-- parent is slow to register. NOTHING IN THE SCHEMA NEEDED TO CHANGE for that
-- — the parent link is a join table (parent_students), so a student with zero
-- parent rows is already legal. "Unclaimed" is DERIVED (no parent_students
-- row), never stored: a flag beside the join table it duplicates goes stale the
-- day someone forgets to write it, the same disease students.age had.
--
-- What DOES need a home is money. A billable lesson attended by an unclaimed
-- student cannot be invoiced — invoices.parent_id and payment_records.invoice_id
-- are both NOT NULL, so there is no parent to bill and no rail to record the
-- payment on. In practice the money still moves (PayNow, direct to the
-- business), and until now SwimSync had nowhere to say so.
--
-- Hence student_settlements. Two things it deliberately is:
--
--   • ROWS, NOT COLUMNS ON students. A settlement is money, and money must be
--     countable, summable, and repeatable — a family can trial twice, months
--     apart. A pair of columns answers none of that. (The tenant_level_skills
--     reasoning: a list cannot be a text blob.)
--
--   • EFFECTIVE-DATED, via settled_through, not a boolean. A parent may claim
--     the child later and keep attending, so "is this settled?" has no answer
--     without "as of when?". Attendance ON OR BEFORE settled_through is
--     settled; anything after bills normally. Same idiom as class_rates and
--     wage rates — the spine of this codebase is facts that know their date.
--
-- The engine (phase 2) reads this table to decide whether a month may SEAL. An
-- unclaimed student's billable attendance blocks sealing unless a settlement
-- covers it — otherwise the month seals and those lessons are permanently
-- unbillable, which is the bug this whole feature exists downstream of.
-- ============================================================

-- paid_outside — the money arrived, off-platform. NOT a write-off.
-- written_off  — genuinely not collecting.
-- Both unblock the month; they differ in what they claim happened, which is
-- exactly why one field cannot serve for both.
CREATE TYPE settlement_kind AS ENUM ('paid_outside', 'written_off');

CREATE TABLE student_settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- Attendance on or before this date is settled. See the header.
  settled_through DATE NOT NULL,

  kind            settlement_kind NOT NULL,

  -- Money actually received. Required for paid_outside, forbidden for
  -- written_off — a structural guarantee that "settled" can never silently mean
  -- "no idea what came in". This CHECK is why the enum exists rather than a
  -- nullable boolean.
  amount          NUMERIC(10, 2),
  method          TEXT,
  note            TEXT,

  reversed_at     TIMESTAMPTZ,
  reversed_by     UUID REFERENCES profiles(id),

  recorded_by     UUID NOT NULL REFERENCES profiles(id),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT settlement_amount_matches_kind CHECK (
    (kind = 'paid_outside' AND amount IS NOT NULL AND amount > 0)
    OR
    (kind = 'written_off' AND amount IS NULL)
  ),
  CONSTRAINT settlement_reversal_is_complete CHECK (
    (reversed_at IS NULL AND reversed_by IS NULL)
    OR
    (reversed_at IS NOT NULL AND reversed_by IS NOT NULL)
  )
);

-- The engine's hot path: "does any live settlement for this student cover this
-- lesson's date?" — student first, then the date bound.
CREATE INDEX student_settlements_student_through
  ON student_settlements (student_id, settled_through)
  WHERE reversed_at IS NULL;

CREATE INDEX student_settlements_tenant ON student_settlements (tenant_id);

COMMENT ON COLUMN student_settlements.settled_through IS
  'Attendance on or before this date is settled and does not block month sealing. Effective-dated deliberately: a parent may claim the child later and keep attending.';

COMMENT ON COLUMN student_settlements.reversed_at IS
  'A settlement is REVERSIBLE, not deletable — a parent who turns up two months after a write-off must be recoverable, and the original record of the decision must survive. A reversed row stops covering attendance (see the partial index).';

-- NO CHECK THAT settled_through IS NOT IN THE FUTURE, deliberately.
-- A future date would pre-authorise the block not to fire, which is a real
-- hole — but the only way to express "not in the future" in a CHECK is
-- CURRENT_DATE, which on Supabase is UTC. Before 08:00 SGT that is YESTERDAY
-- (§7.7), so a settlement correctly dated today would be refused for eight
-- hours every day. The bound is enforced where the app timezone is known:
-- the admin UI defaults settled_through to today and never offers a future date.

ALTER TABLE student_settlements ENABLE ROW LEVEL SECURITY;

-- Read: the business's own admin, and the platform admin for support.
-- Deliberately NOT the coach: they neither record nor need these, and a
-- settlement names money the business received.
CREATE POLICY student_settlements_select ON student_settlements FOR SELECT TO authenticated
  USING (is_platform_admin() OR can_admin_tenant(tenant_id));

-- Write: the business's admin only (the user's explicit call — the coach
-- signals a settlement is due by marking the lesson trial_paid, and the admin
-- records it). No coach branch here, and there is deliberately no DELETE
-- policy: reversal is an UPDATE, so the decision survives.
CREATE POLICY student_settlements_insert ON student_settlements FOR INSERT TO authenticated
  WITH CHECK (can_admin_tenant(tenant_id));

CREATE POLICY student_settlements_update ON student_settlements FOR UPDATE TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE ON student_settlements TO authenticated, service_role;

-- ------------------------------------------------------------
-- What the coach scribbles at the poolside.
--
-- The phone column ships NOW even though matching is slice 2, for the §5.1
-- address reason: a field added later only ever holds data for people who
-- arrived after it shipped. The coach captures the number in the same breath
-- as the name or not at all — and it is the single strongest signal slice 2's
-- matcher has, because profiles.phone already exists on the parent side.
-- ------------------------------------------------------------

ALTER TABLE students
  ADD COLUMN provisional_contact_name  TEXT,
  ADD COLUMN provisional_contact_phone TEXT,
  ADD COLUMN provisional_contact_email TEXT;

COMMENT ON COLUMN students.provisional_contact_phone IS
  'The number the coach arranged the trial on. Captured at creation for an unclaimed student; the strongest match signal when the parent later registers (profiles.phone is already collected).';
