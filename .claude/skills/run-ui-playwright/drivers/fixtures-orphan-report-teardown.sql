-- Teardown for fixtures-orphan-report.sql — removes exactly what the fixture
-- (and a driver run over it) created, in dependency order. The driver WRITES
-- student_settlements rows as its main act, so those go first; they are also
-- why the fixture is not re-runnable without this file.

DELETE FROM student_settlements
 WHERE student_id::text LIKE 'ab500000-%';

DELETE FROM attendance
 WHERE lesson_session_id::text LIKE 'ab400000-%';

DELETE FROM lesson_sessions
 WHERE id::text LIKE 'ab400000-%';

DELETE FROM billing_periods
 WHERE tenant_id = 'ab000000-0000-0000-0000-000000000001';

DELETE FROM classes
 WHERE id = 'ab000000-1111-0000-0000-000000000001';

DELETE FROM class_categories
 WHERE tenant_id = 'ab000000-0000-0000-0000-000000000001';

DELETE FROM students
 WHERE id::text LIKE 'ab500000-%';

-- profiles / coaches / parents rows cascade from auth.users; the tenant row
-- last, once nothing references it.
DELETE FROM auth.users
 WHERE id::text LIKE 'ab100000-%';

DELETE FROM tenants
 WHERE id = 'ab000000-0000-0000-0000-000000000001';
