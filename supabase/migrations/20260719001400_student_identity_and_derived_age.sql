-- Student identity: name + date of birth, with age derived rather than stored.
--
-- WHY name + DOB, and not NRIC: a name alone is not an identifier — two
-- children called "Ethan Tan" on one roster leave the coach guessing on the
-- attendance screen. Name + DOB tells them apart and, unlike a partial NRIC,
-- introduces NO new personal data: date_of_birth is already collected and
-- already required by the add-child form. Partial NRIC is still personal data
-- under PDPC guidance, so the version of this that needed a regulatory
-- justification was dropped in favour of the one that needs none.
--
-- WHY drop age: it was a stored integer sitting beside date_of_birth, which is
-- the actual fact. It went stale the day after it was written — the same
-- second-source-of-truth disease that effective-dated pricing removed from
-- money (class_rates), and that dropping the `inactive` assignment_status
-- removed from student status. Verified to have zero readers in either app,
-- the seed, or the billing engine before dropping.

-- 1. Retire the stale duplicate of date_of_birth.
ALTER TABLE students DROP COLUMN IF EXISTS age;

-- 2. One child, once, per business.
--
-- An EXPRESSION index, deliberately: a plain (full_name, date_of_birth) index
-- is defeated by a trailing space or a capital letter, which gives the
-- appearance of a constraint without the substance of one.
--
-- A NULL date_of_birth never collides — Postgres treats NULLs as distinct in a
-- unique index — so any student predating the required-DOB rule is exempt
-- rather than blocking this migration. That property is what makes this safe
-- to apply to live data, and it is why the probe below can only ever report
-- genuine duplicates.
--
-- Scoped per tenant: two businesses may each legitimately teach a child of the
-- same name and birthday, and neither may see the other's roster anyway.
--
-- BEFORE APPLYING TO PRODUCTION, run this probe — it must return zero rows,
-- or the migration will fail partway through a deploy:
--
--   SELECT tenant_id, lower(trim(full_name)) AS nm, date_of_birth, count(*)
--   FROM students
--   GROUP BY 1, 2, 3
--   HAVING count(*) > 1;
--
CREATE UNIQUE INDEX students_identity_uniq
  ON students (tenant_id, lower(trim(full_name)), date_of_birth);

COMMENT ON INDEX students_identity_uniq IS
  'A child is identified by name + date of birth within a business. Expression-'
  'indexed so whitespace and capitalisation cannot defeat it; NULL DOB rows are '
  'exempt by design (Postgres treats NULLs as distinct).';
