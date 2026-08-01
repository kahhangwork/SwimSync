-- ============================================================
-- A make-up is a BOOKING: a child guests into ONE lesson of another class in
-- the same category (MAKEUP_CLASSES_PLAN — the guest-pass model).
--
-- WHY A BOOKING AND NOT AN ENROLMENT. one_active_enrolment_per_student is a
-- partial unique index on student_id alone: a child has at most one active
-- class, ever. A make-up is "expected at THIS ONE lesson", which is exactly
-- what trial_bookings already models — so this table is its shape, with the
-- trial-specific parts inverted: a trial child must NOT be enrolled; a make-up
-- child MUST be. The engine, the completeness gate, the coach roster and the
-- parent app all consume it through the same bookedByDate mechanism trials use.
--
-- WHY TWO SNAPSHOTS (§7.45: classes.category_id is MUTABLE and money depends
-- on it; a fact about a sold lesson is never a live lookup):
--
--   category_id   — the HOME class's category at booking time (== the host's,
--                   enforced by book_makeup). The engine matches PACKAGES
--                   against this, never against the host class's live column:
--                   re-tagging the host class must not detach a package draw
--                   already arranged.
--
--   home_class_id — which class's rate an AD-HOC guest pays. The make-up
--                   replaces the child's own missed lesson, so their usual
--                   price applies — the HOME class's effective-dated rate on
--                   the make-up's own date. The CLASS ID is snapshotted, not
--                   the rate number: class_rates is effective-dated and
--                   correction-aware, and a backdated rate correction must
--                   still flow through to the make-up line.
-- ============================================================

CREATE TABLE makeup_bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- The HOST class — the lesson being guested into.
  class_id      UUID NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  session_date  DATE NOT NULL,

  -- Snapshots — see header.
  category_id   UUID NOT NULL REFERENCES class_categories(id) ON DELETE RESTRICT,
  home_class_id UUID NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,

  booked_by     UUID NOT NULL REFERENCES profiles(id),
  booked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft cancel: history survives, and a cancelled booking expects nobody.
  cancelled_at  TIMESTAMPTZ,
  cancelled_by  UUID REFERENCES profiles(id),

  CONSTRAINT makeup_booking_cancel_is_complete CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  )
);

-- PARTIAL, on purpose — a cancelled booking must not block re-booking the slot
-- ("moved it to next week… actually moved it back" is ordinary).
CREATE UNIQUE INDEX makeup_bookings_live_slot_uniq
  ON makeup_bookings (student_id, class_id, session_date)
  WHERE cancelled_at IS NULL;

-- The roster's hot path: who is expected at this class on this date.
CREATE INDEX makeup_bookings_class_date
  ON makeup_bookings (class_id, session_date)
  WHERE cancelled_at IS NULL;

CREATE INDEX makeup_bookings_tenant ON makeup_bookings (tenant_id);

COMMENT ON COLUMN makeup_bookings.category_id IS
  'SNAPSHOT of the home class''s category at booking time (== host''s then, by book_makeup''s rule). The engine matches packages against THIS, never classes.category_id — that column is mutable and re-tagging a class must not detach an arranged package draw.';
COMMENT ON COLUMN makeup_bookings.home_class_id IS
  'SNAPSHOT of the child''s own class at booking time. An ad-hoc guest bills at THIS class''s effective-dated rate on the make-up''s own date — their usual price, not the host''s.';

ALTER TABLE makeup_bookings ENABLE ROW LEVEL SECURITY;

-- Read: platform admin, the business's admin, the HOST class's coach (who must
-- see who is expected at their own lesson) — and the child's OWN parent, from
-- day one. Trials shipped without the parent branch and the home card was
-- silently dead until 20260726001300 added it; not repeating that.
CREATE POLICY makeup_bookings_select ON makeup_bookings FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = makeup_bookings.class_id
         AND c.coach_id = current_coach_id()
    )
    OR parent_owns_student(student_id)
  );

-- Write: the business's admin only — arranging is the admin's, observing is
-- the coach's (the schedule_extra_lesson split). Cancelling is an UPDATE, so
-- there is deliberately no DELETE policy.
CREATE POLICY makeup_bookings_insert ON makeup_bookings FOR INSERT TO authenticated
  WITH CHECK (can_admin_tenant(tenant_id));

CREATE POLICY makeup_bookings_update ON makeup_bookings FOR UPDATE TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE ON makeup_bookings TO authenticated, service_role;
