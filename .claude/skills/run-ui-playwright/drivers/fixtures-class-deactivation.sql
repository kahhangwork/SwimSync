-- Fixture for verify-class-deactivation.mjs — retiring and restoring a class
-- from the admin Classes page (Wave 1 item #6, Chunk 4).
--
-- THREE CLASSES, AND THE TWO THAT REFUSE ARE THE POINT. The round trip
-- (retire → reload → restore, through the UI alone) is what RISK 1's mitigation
-- turns on, but a page that could retire ANYTHING would pass that round trip
-- while having lost all three guards. So the fixture also builds the two states
-- deactivate_class() must refuse, and the driver asserts the refusal text names
-- what is in the way.
--
--   ClsRetire Empty Class     nothing at all              → retires cleanly
--   ClsRetire Enrolled Class  one live enrolment          → REFUSED, names the child
--   ClsRetire Booked Class    one future trial booking    → REFUSED, names child + date
--
-- ⚠ 'ClsRetire Empty Class' MUST STAY EMPTY. No enrolments, no bookings, no
-- sessions — that is what makes it retirable, and it is the only class here the
-- driver can complete the round trip on. If a future edit adds a child to it,
-- the driver goes red on check 4 and the message will not obviously say why.
--
-- ⚠ THIS RUNS AGAINST A STACK OTHER WORKTREES MAY BE SHARING. Everything is
-- namespaced 'ClsRetire ', keyed on fixed UUIDs, and ON CONFLICT DO NOTHING, so
-- re-running is a no-op rather than a second set of rows. Do NOT add a TRUNCATE
-- and do NOT reach for `supabase db reset` — the teardown removes exactly these.
--
-- ⚠ DATES ARE DERIVED IN SGT, NEVER CURRENT_DATE. The server runs UTC, and
-- between 00:00 and 08:00 SGT those are different days (§7.94) — a trial booked
-- "tomorrow" in UTC can be today in SGT, and deactivate_class() compares against
-- today_sg().
--
-- ⚠ THE CLASSES RUN ON A WEEKDAY WITH NO LESSON DATE INSIDE THE MARKING WINDOW
-- that could make the EMPTY class refuse. It has no enrolments and no bookings,
-- so class_unmarked_lesson_dates() finds nobody expected on any date and the
-- third refusal is silent whatever weekday it runs on. Stated because it is the
-- non-obvious reason this fixture does not need a date anchor of its own.

-- ---- Three classes in the seed tenant ----
-- The seed tenant's admin (coach@swimsync.test) is who the driver signs in as.
-- The location the classes sit at (contract: classes.location_id FK).
INSERT INTO locations (id, tenant_id, name) VALUES
  ('c9000000-0000-0000-0000-0000000010c1','70000000-0000-0000-0000-000000000001','ClsRetire Pool')
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_id, price_per_lesson, category_id)
SELECT
  ids.id,
  '70000000-0000-0000-0000-000000000001',
  (SELECT c.id FROM coaches c
     JOIN profiles p ON p.id = c.profile_id
    WHERE p.email = 'coach@swimsync.test'),
  ids.title,
  'wednesday', '16:00', '17:00', 'c9000000-0000-0000-0000-0000000010c1', 30,
  (SELECT id FROM class_categories
    WHERE tenant_id = '70000000-0000-0000-0000-000000000001'
    ORDER BY name LIMIT 1)
FROM (VALUES
  ('c9000000-0000-0000-0000-0000000000e1'::uuid, 'ClsRetire Empty Class'),
  ('c9000000-0000-0000-0000-0000000000e2'::uuid, 'ClsRetire Enrolled Class'),
  ('c9000000-0000-0000-0000-0000000000e3'::uuid, 'ClsRetire Booked Class')
) AS ids(id, title)
-- ⚠ DO UPDATE, NOT DO NOTHING, AND ONLY FOR THESE TWO COLUMNS.
-- The driver RETIRES a class as its main act. If it then dies before restoring
-- it — a sabotage run, a timeout, a red check — DO NOTHING would leave the
-- class retired, and the NEXT run fails its own fixture guard with "Fixture is
-- not in place", which points at the fixture rather than at what actually
-- broke. Measured, not predicted: that is exactly how the first sabotage run
-- ended, and it is §8.36's failure (a driver whose second same-day run dies)
-- arriving through a different door.
--
-- Re-applying the fixture is therefore the reset. Nothing else is overwritten,
-- so a hand-edited title or time survives.
ON CONFLICT (id) DO UPDATE
  SET is_active = TRUE, deactivated_at = NULL;

-- ---- The child who blocks the enrolled class ----
INSERT INTO students (id, full_name, assignment_status, tenant_id)
VALUES ('c9500000-0000-0000-0000-000000000001'::uuid,
        'ClsRetire Mia', 'assigned', '70000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO student_class_enrolments (id, student_id, class_id, is_active)
VALUES ('c9600000-0000-0000-0000-000000000001'::uuid,
        'c9500000-0000-0000-0000-000000000001',
        'c9000000-0000-0000-0000-0000000000e2', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ---- The guest who blocks the booked class ----
-- Deliberately NOT enrolled anywhere: book_trial() refuses a child who already
-- is, and this row is inserted directly rather than through the RPC so the
-- fixture does not depend on the marking floor moving month to month.
INSERT INTO students (id, full_name, assignment_status, tenant_id)
VALUES ('c9500000-0000-0000-0000-000000000002'::uuid,
        'ClsRetire Noah', 'unassigned', '70000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO trial_bookings (id, tenant_id, student_id, class_id, session_date,
                            category_id, booked_by)
SELECT
  'c9700000-0000-0000-0000-000000000001'::uuid,
  '70000000-0000-0000-0000-000000000001',
  'c9500000-0000-0000-0000-000000000002',
  'c9000000-0000-0000-0000-0000000000e3',
  -- +7 days in SGT, so it is future whatever hour the nightly sweep runs at.
  ((now() AT TIME ZONE 'Asia/Singapore')::date + 7),
  (SELECT category_id FROM classes WHERE id = 'c9000000-0000-0000-0000-0000000000e3'),
  (SELECT id FROM profiles WHERE email = 'coach@swimsync.test')
ON CONFLICT (id) DO NOTHING;
