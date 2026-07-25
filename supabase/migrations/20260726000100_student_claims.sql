-- ============================================================
-- student_claims: a parent asking to be attached to a child the business
-- already has on its roster (PARENT_CLAIM_PLAN.md phase 1).
--
-- Slice 1 shipped the INVITE path — the admin asserts the link and there is
-- nothing to get wrong. This is the other direction: the parent registers
-- first, types their child into Add Child, and the name they typed matches a
-- child a coach added weeks ago. Today that produces a SECOND student record
-- with none of the attendance, and nothing detects it.
--
-- A CLAIM IS A REQUEST, NOT A LINK. The link is `parent_students`, and it is
-- written by exactly one function — link_invited_parent() (20260725000300) —
-- which slice 1 already proved on production. Approving a claim CALLS that
-- function; it does not reimplement it. Keeping the request and the link as
-- separate concepts is what lets the admin sit between a parent's assertion
-- and a family's billing history.
--
-- WHY THE ADMIN DECIDES EVERY ONE. A wrong link exposes one family's
-- attendance, invoices and payment record to another. The parent's own
-- certainty cannot price that risk, so "Confirm" and "Not Sure" land in the
-- same queue and differ only in what the admin is told.
-- ============================================================

-- How sure the PARENT said they were. This is evidence for the admin, never a
-- permission: 'confirmed' does not auto-approve, it just tells the admin the
-- parent recognised the child rather than guessed.
CREATE TYPE claim_certainty AS ENUM ('confirmed', 'unsure');

CREATE TYPE claim_status AS ENUM ('pending', 'approved', 'declined', 'withdrawn');

CREATE TABLE student_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id   UUID NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,

  -- ⚠ WHAT THE PARENT TYPED, SNAPSHOTTED — not read back off the student.
  -- Two uses, and both need the parent's own words rather than the candidate's:
  --   • the admin judges "is this the same child?" by comparing what the parent
  --     wrote against the row on their roster. Showing them the candidate twice
  --     answers nothing.
  --   • a DECLINE has to hand the parent back their own input so they can
  --     create the child without retyping it.
  -- Same rule as invoice_items.student_name: a fact about a past act is never a
  -- live lookup (§6).
  claimed_name    TEXT NOT NULL,
  claimed_dob     DATE,
  claimed_gender  TEXT,
  claimed_notes   TEXT,

  certainty     claim_certainty NOT NULL,

  -- Which signal produced the candidate: 'name_dob' | 'name_only' | 'phone'.
  -- Shown to the admin in plain words, because "matched on name only" and
  -- "matched on name and date of birth" deserve different amounts of scrutiny.
  match_reason  TEXT NOT NULL,

  status        claim_status NOT NULL DEFAULT 'pending',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ,
  decided_by  UUID REFERENCES profiles(id),

  -- A decided claim must say when. decided_by is deliberately NOT required:
  -- approve_student_claim() auto-declines the OTHER claims on the same child
  -- (see the plan's RISK 6), and those are decided by the system as a
  -- consequence, not by a person choosing them.
  CONSTRAINT claim_decision_is_complete CHECK (
    (status = 'pending'  AND decided_at IS NULL AND decided_by IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL)
  )
);

-- PARTIAL, for the same reason as trial_bookings_live_slot_uniq: a plain unique
-- constraint would let a DECLINED claim permanently block this parent from ever
-- claiming this child again — and "the admin declined it by mistake" is an
-- ordinary thing to need to undo.
CREATE UNIQUE INDEX student_claims_live_uniq
  ON student_claims (parent_id, student_id) WHERE status = 'pending';

-- The badge's hot path: how many claims is this business sitting on?
CREATE INDEX student_claims_pending_tenant
  ON student_claims (tenant_id) WHERE status = 'pending';

CREATE INDEX student_claims_parent ON student_claims (parent_id);

-- ⚠ THE "ALREADY PENDING" BLOCK IS A QUERY, NOT AN INDEX — DO NOT "TIDY" IT
-- INTO ONE. The tempting constraint is
--   UNIQUE (parent_id, tenant_id, lower(trim(claimed_name)), claimed_dob)
--     WHERE status = 'pending'
-- and it DOES NOT HOLD, because NULLs never collide in a unique index. A parent
-- claiming a child with no date of birth could file the same claim endlessly.
-- That is the exact mechanism that lets duplicate students form in the first
-- place (students_identity_uniq exempts NULL DOB), so reintroducing it here
-- would rebuild the bug this table exists to prevent. add_child_or_claim()
-- checks with IS NOT DISTINCT FROM, where NULL = NULL is true.
COMMENT ON TABLE student_claims IS
  'A parent asking to be attached to an existing student. The admin decides every one; approval calls link_invited_parent(). Never write parent_students from here.';

COMMENT ON COLUMN student_claims.claimed_name IS
  'What the PARENT typed, snapshotted — the admin compares it against the candidate, and a decline hands it back so they need not retype it.';

ALTER TABLE student_claims ENABLE ROW LEVEL SECURITY;

-- Read: the parent who filed it, and the business's admin. The platform admin
-- sees everything, as everywhere else.
CREATE POLICY student_claims_select ON student_claims FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_id = current_parent_id()
    OR is_tenant_admin(tenant_id)
  );

-- ⚠ NO INSERT, UPDATE OR DELETE POLICY, DELIBERATELY. Every write goes through
-- a SECURITY DEFINER function (add_child_or_claim, approve_student_claim,
-- decline_student_claim, undo_student_claim), so there is no client write path
-- to get wrong. A parent who could INSERT here could file a claim against any
-- student id they could guess; one who could UPDATE could approve their own.
-- If a future feature needs a new write, add a FUNCTION, not a policy.
GRANT SELECT ON student_claims TO authenticated, service_role;
