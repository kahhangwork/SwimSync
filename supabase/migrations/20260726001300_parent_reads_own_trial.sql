-- ============================================================
-- A PARENT MAY READ THEIR OWN CHILD'S TRIAL BOOKING.
--
-- trial_bookings_select (20260725000700) covered the platform admin, the
-- business's admin, and the class's coach — and nobody else. A parent is none
-- of those: `current_tenant_id()` is NULL for them (parents are global, they
-- have no tenant_id on profiles) and they are not a coach. So a parent could
-- not see that their own child had a lesson booked. Verified before fixing:
-- SELECT count(*) FROM trial_bookings as the parent returns 0.
--
-- That was harmless while nothing parent-facing read the table. It stopped
-- being harmless the moment the parent's home card tried to say WHEN the trial
-- is — the feature would have shipped silently dead, showing the old
-- "the admin will assign your child soon" to every family with a booked trial.
-- Caught by verify-trial-visibility.mjs, which is the whole reason that driver
-- exists: a policy gap looks exactly like a feature that was never written.
--
-- ⚠ SCOPED TO THEIR OWN CHILD, via parent_owns_student() — the same helper
-- students_select uses. Not "any booking at a tenant they have joined": a
-- business's other families' trials are not this parent's business, and the
-- booking carries a child's name, class and date.
-- ============================================================

DROP POLICY IF EXISTS trial_bookings_select ON trial_bookings;

CREATE POLICY trial_bookings_select ON trial_bookings FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM classes c
       WHERE c.id = trial_bookings.class_id
         AND c.coach_id = current_coach_id()
    )
    -- The family's own child, and only theirs.
    OR parent_owns_student(student_id)
  );

COMMENT ON POLICY trial_bookings_select ON trial_bookings IS
  'Platform admin, the business''s admin, the class''s coach — and the child''s OWN parent, so the app can tell a family when their trial is.';
