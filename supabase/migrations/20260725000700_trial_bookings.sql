-- ============================================================
-- A trial is a BOOKING (TRIAL_BOOKINGS_PLAN.md phase 3).
--
-- WHAT CHANGED AND WHY. The first version of trials made the coach create the
-- child, gave them a closed enrolment, created a lesson_sessions row and wrote
-- an attendance row pre-set to Paid/Free trial. All three were wrong:
--
--   • it made booking AHEAD impossible, which is the common case — trials are
--     arranged days in advance;
--   • writing attendance at creation asserted an outcome nobody had observed.
--     A booked child can turn up, not turn up, or have the lesson rained off;
--   • it used an ENROLMENT to mean "here once". An enrolment is a standing
--     arrangement, which is why it needed a closed-enrolment trick whose only
--     purpose was to stop the child being expected forever.
--
-- A booking says one thing: THIS CHILD IS EXPECTED AT THIS ONE LESSON. The
-- coach then marks them exactly like anyone else — present, absent, cancelled,
-- trial paid, trial free — and billing follows the attendance row as always.
--
-- WHAT THIS BUYS BACK: nothing here writes `lesson_sessions`, so
-- add_unclaimed_student() stops being its second writer. Sessions go back to
-- being created lazily by the attendance save alone, as §6 describes, and the
-- double-billing guard that §7.43 existed for is no longer needed.
-- ============================================================

CREATE TABLE trial_bookings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  session_date DATE NOT NULL,

  -- ⚠ THE CATEGORY IS SNAPSHOTTED HERE, AND THE ENGINE PRICES FROM THIS COLUMN.
  --
  -- Trial pricing resolves through a category — but `classes.category_id` is a
  -- plain MUTABLE column, unlike every other input to money in this schema
  -- (class_rates, coach_rates, trial_rates are all effective-dated). Re-tag a
  -- class from Group to Private and, without this snapshot, every unbilled
  -- trial in it would silently reprice at the Private rate across the five-week
  -- window between a lesson and its invoice run.
  --
  -- This is the same rule invoice_items.student_name follows: A FACT ABOUT A
  -- PAST LESSON IS NEVER A LIVE LOOKUP (§6). The booking is the record of what
  -- was sold.
  category_id  UUID NOT NULL REFERENCES class_categories(id) ON DELETE RESTRICT,

  booked_by    UUID NOT NULL REFERENCES profiles(id),
  booked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft cancel: history survives, and a cancelled booking expects nobody.
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES profiles(id),

  CONSTRAINT trial_booking_cancel_is_complete CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  )
);

-- PARTIAL, on purpose. A plain unique constraint would let a CANCELLED booking
-- permanently block re-booking that same slot — and "moved it to next week…
-- actually moved it back" is an ordinary thing to do.
CREATE UNIQUE INDEX trial_bookings_live_slot_uniq
  ON trial_bookings (student_id, class_id, session_date)
  WHERE cancelled_at IS NULL;

-- The roster's hot path: who is expected at this class on this date.
CREATE INDEX trial_bookings_class_date
  ON trial_bookings (class_id, session_date)
  WHERE cancelled_at IS NULL;

CREATE INDEX trial_bookings_tenant ON trial_bookings (tenant_id);

COMMENT ON COLUMN trial_bookings.category_id IS
  'SNAPSHOT of the class''s category at booking time. The engine prices a paid trial from THIS, never from classes.category_id — that column is mutable, and re-tagging a class must not reprice trials already taught.';

ALTER TABLE trial_bookings ENABLE ROW LEVEL SECURITY;

-- Read: the business's admin, the platform admin, AND the class's coach — who
-- must be able to see who is expected at their own lesson.
CREATE POLICY trial_bookings_select ON trial_bookings FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = trial_bookings.class_id
         AND c.coach_id = current_coach_id()
    )
  );

-- Write: the business's admin only. The coach's job is marking attendance;
-- a school's trials are arranged by the admin, and a private coach IS the
-- admin. Cancelling is an UPDATE, so there is deliberately no DELETE policy.
CREATE POLICY trial_bookings_insert ON trial_bookings FOR INSERT TO authenticated
  WITH CHECK (can_admin_tenant(tenant_id));

CREATE POLICY trial_bookings_update ON trial_bookings FOR UPDATE TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE ON trial_bookings TO authenticated, service_role;
