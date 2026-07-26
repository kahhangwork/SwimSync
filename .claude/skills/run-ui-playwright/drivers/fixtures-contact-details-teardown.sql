-- Teardown for fixtures-contact-details.sql.
--
-- Run this when you are done driving verify-contact-details.mjs:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < drivers/fixtures-contact-details-teardown.sql
--
-- WHY THIS EXISTS RATHER THAN `supabase db reset`. The local stack is shared
-- with every other worktree and session on this machine; a reset would destroy
-- whatever they were mid-way through — and as of 2026-07-26 one worktree was
-- carrying an uncommitted migration that only the running database held.
-- Leaving the rows behind is not harmless either: four children appear on
-- everyone's Students page with no explanation, and two of them are claimed, so
-- they alter the "No parent account" count the admin filters on.
--
-- Order matters: the claim before the student, the student before the parent,
-- the parent before the auth user — or the FKs refuse.

-- A claim references BOTH the student and the parent.
DELETE FROM student_claims
 WHERE student_id::text LIKE 'cd000000-%';

DELETE FROM student_class_enrolments
 WHERE student_id::text LIKE 'cd000000-%';

DELETE FROM parent_students
 WHERE student_id::text LIKE 'cd000000-%';

DELETE FROM students
 WHERE id::text LIKE 'cd000000-%';

-- Also clear anything the DRIVER created rather than the fixture. It adds this
-- child through the real Add-a-student form to prove a bad phone number does not
-- block creation, and deletes it again — but a run that dies mid-way leaves it.
DELETE FROM student_class_enrolments
 WHERE student_id IN (SELECT id FROM students WHERE full_name = 'Quentin Newkid');
DELETE FROM students WHERE full_name = 'Quentin Newkid';

DELETE FROM parent_tenants
 WHERE parent_id IN (
   SELECT id FROM parents WHERE profile_id::text LIKE 'cd000000-%'
 );

DELETE FROM parents
 WHERE profile_id::text LIKE 'cd000000-%';

DELETE FROM profiles
 WHERE id::text LIKE 'cd000000-%';

-- Deleting the auth user is what actually reclaims the email addresses, so a
-- later re-run of the fixture inserts cleanly instead of hitting ON CONFLICT and
-- silently reusing a half-removed identity.
DELETE FROM auth.users
 WHERE id::text LIKE 'cd000000-%';

-- Should print 0 for every column.
SELECT (SELECT count(*) FROM students   WHERE id::text LIKE 'cd000000-%')         AS students,
       (SELECT count(*) FROM students   WHERE full_name = 'Quentin Newkid')       AS driver_leftovers,
       (SELECT count(*) FROM parents    WHERE profile_id::text LIKE 'cd000000-%') AS parents,
       (SELECT count(*) FROM profiles   WHERE id::text LIKE 'cd000000-%')         AS profiles,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'cd000000-%')         AS auth_users;
