-- Verification scenario: a recent Saturday that was never marked.
--
--   marked_sat  = the Saturday BEFORE last — session exists, both children marked
--   missing_sat = the most recent past Saturday — NO session row at all
--
-- ⚠ THESE DATES ARE DERIVED AND MUST STAY DERIVED. Until 2026-08-30 they read
-- '2026-07-04' and '11 July', written on 2026-07-15 and correct for six weeks.
-- An absolute lesson date dies when the MARKING WINDOW moves past it:
-- markable_floor is the 1st of LAST month, so these lessons would have dropped
-- out of the needs-marking backlog on 2026-09-01 — silently, because an empty
-- backlog is a valid screen, not an error. Confirmed by simulation before the
-- fix (§7.226). Both Saturdays here sit within 14 days of today, so they are
-- inside the window BY CONSTRUCTION, at any date this ever runs.
--
-- The formula is the house one (see fixtures-trial-visibility.sql): the most
-- recent Saturday STRICTLY before today, in SGT — never CURRENT_DATE (§7.7),
-- and the `= 6` arm is what stops "today" counting as its own last Saturday.
--
-- The drivers derive everything else from the marked row (missing = marked + 7),
-- so this file is the ONLY place the scenario's dates are stated.

-- The scenario's ONE statement of its dates. A TEMP view, so it lives exactly as
-- long as this psql session and leaves nothing behind for the teardown to find.
-- missing_sat = the LAST Saturday of the PREVIOUS calendar month.
--
-- ⚠ "THE MOST RECENT SATURDAY" IS WRONG HERE, and the driver proves it: this
-- fixture also feeds the invoice-generation block, and a billing month must have
-- ENDED before it can be billed (PRD §7.7). The most recent Saturday is usually
-- in the CURRENT month, which has not finished, so the admin half of
-- verify-unmarked-lessons fails on a completely different code path. Last month
-- satisfies both constraints at once: it has ended, AND markable_floor is the
-- 1st of last month, so its Saturdays are always inside the marking window.
--
-- marked_sat = missing_sat - 7 is always in the same month: the last Saturday of
-- any month falls on the 22nd or later, so minus seven is the 15th or later.
CREATE TEMP VIEW fixture_dates AS
WITH d AS (
  SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')::date)::date - 1)
           AS last_day_prev_month
)
SELECT (
  d.last_day_prev_month
    - ((EXTRACT(DOW FROM d.last_day_prev_month)::int + 1) % 7)
) AS missing_sat
FROM d;

-- Parent auth user (the handle_new_user trigger creates profiles + parents)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'b0000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'parent@swimsync.test',
  crypt('password123', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Test Parent","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
);

-- Two children, linked to the parent, enrolled since 1 July
WITH p AS (
  SELECT id FROM parents WHERE profile_id = 'b0000000-0000-0000-0000-000000000001'
), s AS (
  INSERT INTO students (full_name, assignment_status, is_active, tenant_id)
  VALUES ('Ana Tan', 'assigned', true, '70000000-0000-0000-0000-000000000001'),
         ('Ben Tan', 'assigned', true, '70000000-0000-0000-0000-000000000001')
  RETURNING id
)
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id FROM p CROSS JOIN s;

-- SCOPED TO THIS FIXTURE'S OWN CHILDREN. This used to be a bare
-- `FROM students st CROSS JOIN classes c`, with no filter on `st` — it enrolled
-- EVERY student in the database into Saturday Beginners, including other
-- fixtures' children and any sibling worktree's. That is not cosmetic: an active
-- enrolment makes a child *expected at every lesson*, and an unmarked expected
-- lesson blocks invoice generation outright with no override (PRD §7.7), so this
-- fixture could make an unrelated billing test refuse for a reason that had
-- nothing to do with the code under test.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT st.id, c.id,
       -- 3 days before marked_sat, matching the original 1 Jul / 4 Jul spacing.
       -- ⚠ NOT EARLIER. The backlog's lower bound is max(server floor, earliest
       -- enrolment), so an enrolment further back drags EXTRA unmarked Saturdays
       -- into the needs-marking list and the "backlog clears" check can never
       -- pass. Exactly two Saturdays may be in window: marked_sat and missing_sat.
       ((SELECT missing_sat FROM fixture_dates) - 10)::timestamptz, true
FROM students st
JOIN parent_students ps ON ps.student_id = st.id
JOIN parents pa        ON pa.id = ps.parent_id
CROSS JOIN classes c
WHERE c.title = 'Saturday Beginners'
  AND pa.profile_id = 'b0000000-0000-0000-0000-000000000001'
  AND st.full_name IN ('Ana Tan', 'Ben Tan');

-- Saturday 4 July: session exists, both students marked present.
--
-- SCOPED, for the same reason as the enrolment above — this was
-- `FROM sess CROSS JOIN students st`, which marked EVERY student in the database
-- present on 4 July. Attendance is what billing is derived from, so those rows
-- were not just noise: they were billable lessons attributed to other fixtures'
-- children.
WITH sess AS (
  INSERT INTO lesson_sessions (class_id, session_date, status)
  SELECT c.id, (SELECT missing_sat FROM fixture_dates) - 7, 'completed'
    FROM classes c WHERE c.title = 'Saturday Beginners'
  RETURNING id
)
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by, marked_at)
SELECT sess.id, st.id, 'present', 'c0000000-0000-0000-0000-000000000001', NOW()
FROM sess
CROSS JOIN students st
JOIN parent_students ps ON ps.student_id = st.id
JOIN parents pa        ON pa.id = ps.parent_id
WHERE pa.profile_id = 'b0000000-0000-0000-0000-000000000001'
  AND st.full_name IN ('Ana Tan', 'Ben Tan');

-- missing_sat: DELIBERATELY ABSENT. No lesson_sessions row, no attendance.
-- This is the lesson the coach forgot, and the whole point of the feature.

-- A third child who is NOT assigned to any class — the state a parent lands in
-- during onboarding (PRD §5.1). No enrolment, so she contributes no expected
-- lessons and is invisible to the coach/admin coverage checks; she exists so the
-- parent Attendance screen's "not assigned yet" state is reachable.
WITH p AS (
  SELECT id FROM parents WHERE profile_id = 'b0000000-0000-0000-0000-000000000001'
), s AS (
  INSERT INTO students (full_name, assignment_status, is_active, tenant_id)
  VALUES ('Julia Tan', 'unassigned', true, '70000000-0000-0000-0000-000000000001')
  RETURNING id
)
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id FROM p CROSS JOIN s;

SELECT session_date, (SELECT count(*) FROM attendance a WHERE a.lesson_session_id = ls.id) AS marked
FROM lesson_sessions ls ORDER BY session_date;
