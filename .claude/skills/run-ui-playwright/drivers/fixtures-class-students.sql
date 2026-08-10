-- Fixture for verify-class-students.mjs — the admin Classes page's
-- "See students" drawer and its "2+1" count badge.
--
-- SIX CHILDREN IN ONE CLASS, THREE OF WHICH MUST NOT BE COUNTED. The three
-- negative controls are the point: every exclusion rule in classRoster.ts is
-- one of them, and an assertion that a child is absent from the screen passes
-- vacuously if that child was never created. The driver therefore proves all
-- six EXIST in the database before it asserts anything about the UI.
--
--   ClsRoster Anna   active enrolment, LEVEL SET, known joined date  → enrolled
--   ClsRoster Ben    active enrolment, no level                      → enrolled
--   ClsRoster Chloe  enrolment is_active = FALSE                     → nowhere
--   ClsRoster Dev    trial, today + 7                                → trials
--   ClsRoster Eve    trial, today - 7 (past)                         → nowhere
--   ClsRoster Finn   trial, today + 7, CANCELLED                     → nowhere
--
-- Expected badge: 2+1.
--
-- ⚠ THIS RUNS AGAINST A STACK OTHER WORKTREES MAY BE SHARING. Everything is
-- namespaced 'ClsRoster ', keyed on fixed UUIDs, and ON CONFLICT DO NOTHING,
-- so re-running it is a no-op rather than a second set of rows. Do NOT add a
-- TRUNCATE, and do NOT reach for `supabase db reset` to clean up — the driver
-- has a teardown that removes exactly these rows.
--
-- ⚠ DATES ARE DERIVED IN SGT, NEVER CURRENT_DATE. The server runs UTC, and
-- between 00:00 and 08:00 SGT those are different days — the bug that made
-- the lesson_packages suite fail for eight hours a day for six days.

-- ---- The level, so one child has a label the driver can assert on ----
-- If the tenant_levels embed silently fails to resolve, every child renders
-- "No level set", which looks like data rather than a bug. Asserting this
-- exact string on screen turns that failure into a red driver.
-- ON CONFLICT on the PRIMARY KEY, not (tenant_id, label): the label uniqueness
-- is an EXPRESSION index — tenant_levels_label_uniq on
-- (tenant_id, lower(trim(label))) — which `ON CONFLICT (tenant_id, label)`
-- does not match, and Postgres rejects the statement outright rather than
-- ignoring it. A fixed id gives the idempotency either way.
INSERT INTO tenant_levels (id, tenant_id, label, sort_order)
VALUES ('c5000000-0000-0000-0000-000000000010'::uuid,
        '70000000-0000-0000-0000-000000000001', 'ClsRoster Otter', 10)
ON CONFLICT (id) DO NOTHING;

-- ---- The class. Its own class, so the count is deterministic and cannot be
-- ---- disturbed by another fixture's children landing in the seed class.
-- day_of_week is TODAY's SGT weekday, so today±7 both fall on class days.
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_name, price_per_lesson, category_id,
                     is_active)
SELECT 'c5000000-0000-0000-0000-0000000000C1'::uuid,
       '70000000-0000-0000-0000-000000000001',
       co.id,
       'ClsRoster Class',
       lower(to_char((now() AT TIME ZONE 'Asia/Singapore')::date, 'FMday'))::day_of_week,
       '09:00', '10:00', 'ClsRoster Pool', 30.00,
       '7c000000-0000-0000-0000-000000000002',
       TRUE
  FROM coaches co
 WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;

-- ---- The six children ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active,
                      level_id, provisional_contact_phone)
VALUES
  ('c5000000-0000-0000-0000-0000000000A1'::uuid,'ClsRoster Anna',
   '70000000-0000-0000-0000-000000000001','assigned',   TRUE,
   'c5000000-0000-0000-0000-000000000010'::uuid,'92220001'),
  ('c5000000-0000-0000-0000-0000000000B1'::uuid,'ClsRoster Ben',
   '70000000-0000-0000-0000-000000000001','assigned',   TRUE, NULL,'92220002'),
  ('c5000000-0000-0000-0000-0000000000C2'::uuid,'ClsRoster Chloe',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE, NULL,'92220003'),
  ('c5000000-0000-0000-0000-0000000000D1'::uuid,'ClsRoster Dev',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE, NULL,'92220004'),
  ('c5000000-0000-0000-0000-0000000000E1'::uuid,'ClsRoster Eve',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE, NULL,'92220005'),
  ('c5000000-0000-0000-0000-0000000000F1'::uuid,'ClsRoster Finn',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE, NULL,'92220006')
ON CONFLICT (id) DO NOTHING;

-- ---- Enrolments: two live, one closed ----
-- Anna's enrolled_at is fixed so the driver can assert the rendered date
-- rather than "some date". Noon +08 so no timezone reading can move the day.
-- ⚠ NOT `ON CONFLICT DO NOTHING` — IT DOES NOT MAKE THIS IDEMPOTENT.
-- The only unique index here is PARTIAL: since Wave 2 (20260811000100) it is
-- one_active_enrolment_per_student_class on (student_id, class_id) WHERE
-- is_active — it was on (student_id) alone until a child could hold more than
-- one enrolment. Either way Chloe's enrolment is INACTIVE, so it falls outside
-- the index, conflicts with nothing, and a second run inserts a SECOND copy —
-- silently turning the closed-enrolment control into two rows. The same trap
-- applies to the cancelled booking below. An explicit NOT EXISTS is keyed on
-- what the fixture actually means by "already there".
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at,
                                      is_active, unenrolled_at)
SELECT v.student_id, v.class_id, v.enrolled_at, v.is_active, v.unenrolled_at
  FROM (VALUES
    ('c5000000-0000-0000-0000-0000000000A1'::uuid,
     'c5000000-0000-0000-0000-0000000000C1'::uuid,
     '2026-05-04 12:00:00+08'::timestamptz, TRUE,  NULL::timestamptz),
    ('c5000000-0000-0000-0000-0000000000B1'::uuid,
     'c5000000-0000-0000-0000-0000000000C1'::uuid,
     '2026-06-01 12:00:00+08'::timestamptz, TRUE,  NULL::timestamptz),
    -- The negative control for is_active. A closed enrolment is history, not
    -- membership: this child must not be counted and must not be listed.
    ('c5000000-0000-0000-0000-0000000000C2'::uuid,
     'c5000000-0000-0000-0000-0000000000C1'::uuid,
     '2026-04-01 12:00:00+08'::timestamptz, FALSE,
     '2026-06-20 12:00:00+08'::timestamptz)
  ) AS v(student_id, class_id, enrolled_at, is_active, unenrolled_at)
 WHERE NOT EXISTS (
   SELECT 1 FROM student_class_enrolments e
    WHERE e.student_id = v.student_id AND e.class_id = v.class_id
 );

-- ---- Trial bookings: one upcoming, one past, one cancelled ----
-- Same trap as the enrolments above: trial_bookings_live_slot_uniq is PARTIAL
-- (WHERE cancelled_at IS NULL), so Finn's cancelled booking would re-insert on
-- every run. Guarded by student + class, which is what "already seeded" means
-- here.
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date,
                            category_id, booked_by, cancelled_at, cancelled_by)
SELECT '70000000-0000-0000-0000-000000000001', v.student_id, v.class_id,
       v.session_date, '7c000000-0000-0000-0000-000000000002',
       'c0000000-0000-0000-0000-000000000001', v.cancelled_at, v.cancelled_by
  FROM (VALUES
    ('c5000000-0000-0000-0000-0000000000D1'::uuid,
     'c5000000-0000-0000-0000-0000000000C1'::uuid,
     (now() AT TIME ZONE 'Asia/Singapore')::date + 7,
     NULL::timestamptz, NULL::uuid),
    -- Past: the count is "who is still coming", so this drops out the day
    -- after its lesson. Chased on the Trials page's "Past — needs marking".
    ('c5000000-0000-0000-0000-0000000000E1'::uuid,
     'c5000000-0000-0000-0000-0000000000C1'::uuid,
     (now() AT TIME ZONE 'Asia/Singapore')::date - 7,
     NULL::timestamptz, NULL::uuid),
    -- Cancelled but FUTURE-dated: the date alone would let this one through,
    -- which is exactly why it is here.
    ('c5000000-0000-0000-0000-0000000000F1'::uuid,
     'c5000000-0000-0000-0000-0000000000C1'::uuid,
     (now() AT TIME ZONE 'Asia/Singapore')::date + 7,
     now(), 'c0000000-0000-0000-0000-000000000001'::uuid)
  ) AS v(student_id, class_id, session_date, cancelled_at, cancelled_by)
 WHERE NOT EXISTS (
   SELECT 1 FROM trial_bookings tb
    WHERE tb.student_id = v.student_id AND tb.class_id = v.class_id
 );

-- What the driver will re-derive and check for itself.
SELECT s.full_name,
       e.is_active                       AS enrolment_active,
       tb.session_date,
       (tb.cancelled_at IS NOT NULL)     AS booking_cancelled,
       CASE WHEN tb.session_date >= (now() AT TIME ZONE 'Asia/Singapore')::date
            THEN 'UPCOMING' ELSE 'PAST' END AS when_
  FROM students s
  LEFT JOIN student_class_enrolments e
         ON e.student_id = s.id
        AND e.class_id = 'c5000000-0000-0000-0000-0000000000C1'::uuid
  LEFT JOIN trial_bookings tb
         ON tb.student_id = s.id
        AND tb.class_id = 'c5000000-0000-0000-0000-0000000000C1'::uuid
 WHERE s.full_name LIKE 'ClsRoster %'
 ORDER BY s.full_name;
