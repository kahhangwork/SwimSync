-- THE TEMPLATE A NEW FIXTURE COPIES (for _TEMPLATE.mjs). Not `fixtures-*`, so
-- nothing loads it; check-driver-clock.sh holds it to the fixture rule.
--
-- Copy to fixtures-<name>.sql, and write fixtures-<name>-teardown.sql beside it
-- (check-teardowns.sh) — it must find its rows on the SAME clock, so derive its
-- dates exactly the way this file does.
--
-- ⚠ THE CLOCK CONTRACT. Every date is derived from app_today() / app_now(), never
-- now() / CURRENT_DATE / a typed literal. Under `run-all-drivers.sh --now` the
-- database-level pin moves app_today() and the fixture follows; unpinned it is
-- the real SGT date. (CURRENT_DATE is the UTC date — a day behind before 08:00
-- SGT, §7.7 — so it is not even right unpinned.) A value that feeds a REAL-TIME
-- window (an invitation expiry, an email lease, §6af) keeps now() and says so:
--   …, now() + interval '15 minutes', …   -- clock-real: invitation expiry is real time
--
-- Fixed ids carry 0000 (check-fixture-ids.sh); names carry the driver's prefix
-- so a teardown can find them.
--
-- Load:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-<name>.sql

-- A class on today's weekday, so the coach's Today list shows it on whatever
-- day (or pinned moment) the driver runs.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id)
SELECT '7e000000-0000-0000-0000-00000000aa01', co.id, 'Template Class',
       lower(trim(to_char(app_today(), 'FMDay')))::day_of_week, '09:00', '10:00',
       '71000000-0000-0000-0000-000000000001', 25.00, '7c000000-0000-0000-0000-000000000002'
FROM coaches co
WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;

-- A lesson a week ago, relative to the (possibly pinned) day.
INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('7e000000-0000-0000-0000-00000000aa02', '7e000000-0000-0000-0000-00000000aa01', app_today() - 7)
ON CONFLICT (id) DO NOTHING;
