-- Teardown for fixtures-multi-class.sql. Removes EXACTLY the rows that fixture
-- creates and nothing else — check-fixture-roundtrip.sh asserts the row counts
-- come back identical, so anything missed here shows up as a failure there
-- rather than as a mystery three weeks later.
--
-- Order matters: children before parents, enrolments before the classes and
-- students they reference.

DELETE FROM student_class_enrolments
 WHERE class_id IN (
   'c6000000-0000-0000-0000-00000000000a',
   'c6000000-0000-0000-0000-00000000000b',
   'c6000000-0000-0000-0000-00000000000c'
 )
    OR student_id IN (
   'c6000000-0000-0000-0000-00000000000e',
   'c6000000-0000-0000-0000-00000000000f'
 );

-- The driver adds a class through the UI and removes one through the UI, so
-- audit rows exist for these children whether or not the run got that far.
DELETE FROM audit_log
 WHERE entity_type = 'Student'
   AND entity_id IN (
     'c6000000-0000-0000-0000-00000000000e',
     'c6000000-0000-0000-0000-00000000000f'
   );

DELETE FROM parent_students
 WHERE student_id IN (
   'c6000000-0000-0000-0000-00000000000e',
   'c6000000-0000-0000-0000-00000000000f'
 );

DELETE FROM students
 WHERE id IN (
   'c6000000-0000-0000-0000-00000000000e',
   'c6000000-0000-0000-0000-00000000000f'
 );

DELETE FROM parent_tenants
 WHERE parent_id IN (
   SELECT id FROM parents WHERE profile_id = 'c6000000-0000-0000-0000-00000000000d'
 );

-- class_rates is seeded by the classes_seed_rate trigger, so it must go before
-- the classes do — it is a row this fixture caused to exist.
DELETE FROM class_rates
 WHERE class_id IN (
   'c6000000-0000-0000-0000-00000000000a',
   'c6000000-0000-0000-0000-00000000000b',
   'c6000000-0000-0000-0000-00000000000c'
 );

DELETE FROM classes
 WHERE id IN (
   'c6000000-0000-0000-0000-00000000000a',
   'c6000000-0000-0000-0000-00000000000b',
   'c6000000-0000-0000-0000-00000000000c'
 );

-- auth.users cascades to profiles and parents via the handle_new_user fan-out.
DELETE FROM auth.users WHERE id = 'c6000000-0000-0000-0000-00000000000d';
