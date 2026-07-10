-- ============================================================
-- Row Level Security policies
--
-- Access model (see Database_AccessRuleSummary.md):
--   parent     -> own account, own children, own billing
--   coach      -> own classes, students in those classes, their billing
--   superadmin -> everything
--
-- Helper functions are SECURITY DEFINER so they read profiles/
-- parents/coaches WITHOUT triggering RLS on those tables — this
-- prevents infinite policy recursion. The service_role key (used by
-- the Edge Function and the admin create-coach route) bypasses RLS
-- entirely, so invoice generation / credit notes are unaffected.
-- ============================================================

-- ------------------------------------------------------------
-- Helper functions
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_parent_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM parents WHERE profile_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_coach_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM coaches WHERE profile_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.parent_owns_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM parent_students
    WHERE student_id = p_student_id
      AND parent_id = current_parent_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.coach_owns_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM classes
    WHERE id = p_class_id AND coach_id = current_coach_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.coach_owns_session(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM lesson_sessions s
    JOIN classes c ON c.id = s.class_id
    WHERE s.id = p_session_id AND c.coach_id = current_coach_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.coach_serves_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM student_class_enrolments e
    JOIN classes c ON c.id = e.class_id
    WHERE e.student_id = p_student_id
      AND e.is_active
      AND c.coach_id = current_coach_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.coach_serves_parent(p_parent_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM parent_students ps
    JOIN student_class_enrolments e ON e.student_id = ps.student_id AND e.is_active
    JOIN classes c ON c.id = e.class_id
    WHERE ps.parent_id = p_parent_id
      AND c.coach_id = current_coach_id()
  );
$$;

-- ------------------------------------------------------------
-- PROFILES
--   own profile always; coach profiles readable by anyone signed in
--   (parents need to see their coach's name); superadmin sees all.
-- ------------------------------------------------------------

CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR role = 'coach' OR is_superadmin());

CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR is_superadmin())
  WITH CHECK (id = auth.uid() OR is_superadmin());

-- ------------------------------------------------------------
-- PARENTS  (own row; credit_balance is mutated by SECURITY DEFINER
--           triggers / service role, not directly by users)
-- ------------------------------------------------------------

CREATE POLICY parents_select ON parents FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR is_superadmin() OR coach_serves_parent(id));

CREATE POLICY parents_update ON parents FOR UPDATE TO authenticated
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

-- ------------------------------------------------------------
-- COACHES  (readable by any signed-in user for name / PayNow QR;
--           a coach edits their own row; superadmin edits all)
-- ------------------------------------------------------------

CREATE POLICY coaches_select ON coaches FOR SELECT TO authenticated
  USING (TRUE);

CREATE POLICY coaches_update ON coaches FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR is_superadmin())
  WITH CHECK (profile_id = auth.uid() OR is_superadmin());

-- ------------------------------------------------------------
-- STUDENTS
--   parent: own children (via parent_students)
--   coach:  students actively enrolled in their classes
-- ------------------------------------------------------------

CREATE POLICY students_select ON students FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR parent_owns_student(id)
    OR coach_serves_student(id)
  );

-- A parent creates a student, then links it in parent_students.
CREATE POLICY students_insert ON students FOR INSERT TO authenticated
  WITH CHECK (current_parent_id() IS NOT NULL OR is_superadmin());

CREATE POLICY students_update ON students FOR UPDATE TO authenticated
  USING (is_superadmin() OR parent_owns_student(id))
  WITH CHECK (is_superadmin() OR parent_owns_student(id));

-- ------------------------------------------------------------
-- PARENT_STUDENTS
-- ------------------------------------------------------------

CREATE POLICY parent_students_select ON parent_students FOR SELECT TO authenticated
  USING (parent_id = current_parent_id() OR is_superadmin() OR coach_serves_parent(parent_id));

CREATE POLICY parent_students_insert ON parent_students FOR INSERT TO authenticated
  WITH CHECK (parent_id = current_parent_id() OR is_superadmin());

CREATE POLICY parent_students_delete ON parent_students FOR DELETE TO authenticated
  USING (parent_id = current_parent_id() OR is_superadmin());

-- ------------------------------------------------------------
-- CLASSES  (readable by any signed-in user; managed by superadmin)
-- ------------------------------------------------------------

CREATE POLICY classes_select ON classes FOR SELECT TO authenticated
  USING (TRUE);

CREATE POLICY classes_write ON classes FOR ALL TO authenticated
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

-- ------------------------------------------------------------
-- STUDENT_CLASS_ENROLMENTS
--   read: parent for own child, coach for own class, superadmin
--   write: superadmin (assignment is a superadmin action in MVP)
-- ------------------------------------------------------------

CREATE POLICY enrolments_select ON student_class_enrolments FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR parent_owns_student(student_id)
    OR coach_owns_class(class_id)
  );

CREATE POLICY enrolments_write ON student_class_enrolments FOR ALL TO authenticated
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

-- ------------------------------------------------------------
-- LESSON_SESSIONS
--   read: coach for own classes, parent for their child's class
--   write: coach for own classes, superadmin (coach creates the
--          dated session row when marking attendance)
-- ------------------------------------------------------------

CREATE POLICY sessions_select ON lesson_sessions FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR coach_owns_class(class_id)
    OR EXISTS (
      SELECT 1 FROM student_class_enrolments e
      WHERE e.class_id = lesson_sessions.class_id
        AND parent_owns_student(e.student_id)
    )
  );

CREATE POLICY sessions_write ON lesson_sessions FOR ALL TO authenticated
  USING (is_superadmin() OR coach_owns_class(class_id))
  WITH CHECK (is_superadmin() OR coach_owns_class(class_id));

-- ------------------------------------------------------------
-- ATTENDANCE
--   read: parent for own child, coach for own class session
--   write: coach for own class session, superadmin
-- ------------------------------------------------------------

CREATE POLICY attendance_select ON attendance FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR parent_owns_student(student_id)
    OR coach_owns_session(lesson_session_id)
  );

CREATE POLICY attendance_write ON attendance FOR ALL TO authenticated
  USING (is_superadmin() OR coach_owns_session(lesson_session_id))
  WITH CHECK (is_superadmin() OR coach_owns_session(lesson_session_id));

-- ------------------------------------------------------------
-- INVOICES
--   read: parent (own), coach (serves that parent), superadmin
--   update (mark paid): coach who serves the parent, superadmin
--   insert: service_role (Edge Function) — bypasses RLS
-- ------------------------------------------------------------

CREATE POLICY invoices_select ON invoices FOR SELECT TO authenticated
  USING (
    parent_id = current_parent_id()
    OR is_superadmin()
    OR coach_serves_parent(parent_id)
  );

CREATE POLICY invoices_update ON invoices FOR UPDATE TO authenticated
  USING (is_superadmin() OR coach_serves_parent(parent_id))
  WITH CHECK (is_superadmin() OR coach_serves_parent(parent_id));

-- ------------------------------------------------------------
-- INVOICE_ITEMS  (follow the parent invoice's visibility)
-- ------------------------------------------------------------

CREATE POLICY invoice_items_select ON invoice_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.parent_id = current_parent_id()
          OR is_superadmin()
          OR coach_serves_parent(i.parent_id)
        )
    )
  );

-- ------------------------------------------------------------
-- CREDIT_NOTES  (immutable: no update/delete policy — only the
--                trigger / service role, which bypass RLS, write them)
-- ------------------------------------------------------------

CREATE POLICY credit_notes_select ON credit_notes FOR SELECT TO authenticated
  USING (
    parent_id = current_parent_id()
    OR is_superadmin()
    OR coach_serves_parent(parent_id)
  );

-- ------------------------------------------------------------
-- PAYMENT_RECORDS  (coach who serves the parent, or superadmin)
-- ------------------------------------------------------------

CREATE POLICY payment_records_select ON payment_records FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = payment_records.invoice_id
        AND (coach_serves_parent(i.parent_id) OR i.parent_id = current_parent_id())
    )
  );

CREATE POLICY payment_records_insert ON payment_records FOR INSERT TO authenticated
  WITH CHECK (
    is_superadmin()
    OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = payment_records.invoice_id
        AND coach_serves_parent(i.parent_id)
    )
  );

-- ------------------------------------------------------------
-- AUDIT_LOG  (superadmin read only; writes via service/definer)
-- ------------------------------------------------------------

CREATE POLICY audit_log_select ON audit_log FOR SELECT TO authenticated
  USING (is_superadmin());

-- ------------------------------------------------------------
-- BILLING_PERIODS  (superadmin read; Edge Function via service role)
-- ------------------------------------------------------------

CREATE POLICY billing_periods_select ON billing_periods FOR SELECT TO authenticated
  USING (is_superadmin());
