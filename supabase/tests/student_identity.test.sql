-- pgTAP: a child is identified by name + date of birth, within a business.
--
-- Covers the unique index that replaced the "two Ethan Tans on one roster"
-- problem, and the three properties that make it safe to apply to live data:
-- NULL DOB is exempt, the scope is per-tenant, and whitespace/capitalisation
-- cannot defeat it.
--
-- Its own tenants, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('8b000000-0000-0000-0000-000000000001','ident-a','Identity Swim A','SWIM-IDTA'),
  ('8b000000-0000-0000-0000-000000000002','ident-b','Identity Swim B','SWIM-IDTB');

-- ── The column that was retired ────────────────────────────────────────────
-- age was a stored integer beside date_of_birth. It is derived at read time
-- now (ageFromDob in lessonDates.ts); a stored copy must not come back.
SELECT hasnt_column('public','students','age',
  'students.age is dropped — age is derived from date_of_birth, never stored');
SELECT has_column('public','students','date_of_birth',
  'date_of_birth remains, as the fact age is derived from');

-- ── The identity rule ──────────────────────────────────────────────────────
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id)
VALUES ('5b000000-0000-0000-0000-000000000001','Ethan Tan','2018-03-10',
        'unassigned','8b000000-0000-0000-0000-000000000001');

-- Two genuinely different children who happen to share a name: the case that
-- motivated the whole item. Different DOB, so both are allowed to exist.
SELECT lives_ok($$
  INSERT INTO students (full_name, date_of_birth, assignment_status, tenant_id)
  VALUES ('Ethan Tan','2019-11-02','unassigned','8b000000-0000-0000-0000-000000000001')
$$, 'two children sharing a name are allowed when their birthdays differ');

-- The same child entered twice — what the constraint exists to stop.
SELECT throws_ok($$
  INSERT INTO students (full_name, date_of_birth, assignment_status, tenant_id)
  VALUES ('Ethan Tan','2018-03-10','unassigned','8b000000-0000-0000-0000-000000000001')
$$, '23505', NULL,
  'the same name + DOB twice in one business is rejected');

-- Whitespace and capitalisation must not be a way around it. A raw
-- (full_name, date_of_birth) index would let both of these through, which is
-- why the index is on lower(trim(full_name)).
SELECT throws_ok($$
  INSERT INTO students (full_name, date_of_birth, assignment_status, tenant_id)
  VALUES ('  Ethan Tan  ','2018-03-10','unassigned','8b000000-0000-0000-0000-000000000001')
$$, '23505', NULL,
  'surrounding whitespace does not defeat the identity rule');

SELECT throws_ok($$
  INSERT INTO students (full_name, date_of_birth, assignment_status, tenant_id)
  VALUES ('ETHAN TAN','2018-03-10','unassigned','8b000000-0000-0000-0000-000000000001')
$$, '23505', NULL,
  'capitalisation does not defeat the identity rule');

-- ── Per business, not global ───────────────────────────────────────────────
-- Two businesses may each teach a child of the same name and birthday, and
-- neither can see the other's roster anyway. A global constraint would leak
-- one business's roster into another's error messages.
SELECT lives_ok($$
  INSERT INTO students (full_name, date_of_birth, assignment_status, tenant_id)
  VALUES ('Ethan Tan','2018-03-10','unassigned','8b000000-0000-0000-0000-000000000002')
$$, 'the same child may exist at a DIFFERENT business');

-- ── NULL DOB is exempt, by design ──────────────────────────────────────────
-- date_of_birth is nullable and rows predating the required-DOB rule have
-- none. Postgres treats NULLs as distinct in a unique index, so those rows
-- never collide with each other — which is the property that let this
-- migration be applied to live data without a backfill.
INSERT INTO students (full_name, date_of_birth, assignment_status, tenant_id)
VALUES ('Noah Lim', NULL,'unassigned','8b000000-0000-0000-0000-000000000001');

SELECT lives_ok($$
  INSERT INTO students (full_name, date_of_birth, assignment_status, tenant_id)
  VALUES ('Noah Lim', NULL,'unassigned','8b000000-0000-0000-0000-000000000001')
$$, 'two students with no DOB do not collide — legacy rows stay insertable');

-- But once a DOB is supplied, the rule applies again from that point on.
SELECT lives_ok($$
  INSERT INTO students (full_name, date_of_birth, assignment_status, tenant_id)
  VALUES ('Noah Lim','2020-01-05','unassigned','8b000000-0000-0000-0000-000000000001')
$$, 'a named child with a DOB coexists with same-named rows that have none');

SELECT * FROM finish();
ROLLBACK;
