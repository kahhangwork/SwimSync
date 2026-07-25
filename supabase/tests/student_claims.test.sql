-- pgTAP: parents claiming their own child.
-- find_student_candidates(), add_child_or_claim(), approve/decline/undo.
--
-- WHY THE DISCLOSURE ASSERTIONS MATTER MOST HERE. find_student_candidates() is
-- SECURITY DEFINER — it exists precisely BECAUSE a registering parent matches
-- no branch of students_select and therefore cannot see an unclaimed child at
-- all. So it bypasses RLS completely, and its own two gates (parent_in_tenant,
-- unclaimed-only) plus its masking are the entire boundary between one
-- family's children and another's. The only credential in front of it is a
-- join code, which travels over WhatsApp.
--
-- Assertions 6 and 7 are the load-bearing ones: a surname-only overlap must
-- return NOTHING (or the popup becomes a directory of the business's children),
-- and a tenant the parent has not joined must REFUSE rather than return an
-- empty set (an empty set is what a legitimately empty business looks like).
--
-- ⚠ TWO PARENTS, ON PURPOSE, AND THEY ARE NOT INTERCHANGEABLE.
--   P1 has a phone that matches Ethan's poolside contact number. The phone
--      signal is deliberately INDEPENDENT of the name, so EVERY search P1 makes
--      returns Ethan — including a search for something else entirely. That is
--      correct behaviour and it is what assertion 8 proves.
--   P2 has no phone at all, so their results are pure name matching.
-- Any assertion expecting a count of ZERO, or expecting a child to be created,
-- must therefore use P2 — with P1 it would be measuring the phone match. The
-- first draft of this file used P1 throughout and three assertions failed for
-- exactly that reason.
--
-- METHOD (§7.16): every probe runs inside this explicit transaction with
-- SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session stays
-- superuser, RLS is bypassed and every assertion "passes" — including the ones
-- that must fail.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(37);

-- ── Two businesses ─────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, kind, join_code) VALUES
  ('c1a11111-0000-0000-0000-000000000001','claim-a','CLAIM Business A','school','SWIM-CLMA'),
  ('c1a11111-0000-0000-0000-000000000002','claim-b','CLAIM Business B','school','SWIM-CLMB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','claim-admin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CLAIM Admin A","role":"tenant_admin","tenant_id":"c1a11111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','claim-admin-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CLAIM Admin B","role":"tenant_admin","tenant_id":"c1a11111-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','claim-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CLAIM Coach A","role":"coach","tenant_id":"c1a11111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  -- P1: joined A, and their registered phone matches Ethan's contact number.
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','claim-p1@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CLAIM Parent One","role":"parent"}', now(), now(), '', '', '', ''),
  -- P2: joined A, NO phone. Every name-only assertion belongs to this parent.
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000d2',
   'authenticated','authenticated','claim-p2@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CLAIM Parent Two","role":"parent"}', now(), now(), '', '', '', ''),
  -- P3: joined NOTHING. The tenant-boundary probe.
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-0000000000d3',
   'authenticated','authenticated','claim-p3@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CLAIM Parent Three","role":"parent"}', now(), now(), '', '', '', '');

-- ⚠ WITH THE COUNTRY CODE, DELIBERATELY. The child's number below is stored
-- WITHOUT it — which is exactly how these two get written in real life, the
-- parent typing +65 at registration and the coach writing 8 digits on a form.
-- normalize_phone() compares the last 8 digits for this reason; before that fix
-- this assertion failed and the strongest non-name signal never fired at all.
UPDATE profiles SET phone = '+65 9111 2222' WHERE id = 'c1000000-0000-0000-0000-0000000000d1';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'c1a11111-0000-0000-0000-000000000001'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
 WHERE pr.email IN ('claim-p1@test.local','claim-p2@test.local');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE t.id IN ('c1a11111-0000-0000-0000-000000000001','c1a11111-0000-0000-0000-000000000002')
   AND NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
VALUES ('c1a55555-0000-0000-0000-000000000001','c1a11111-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='c1000000-0000-0000-0000-0000000000c1'),
  'CLAIM Class A','saturday','10:00','11:00','Pool A', 30,
  (SELECT id FROM class_categories WHERE tenant_id='c1a11111-0000-0000-0000-000000000001'
      AND lower(trim(name))='default group'));

-- ── The roster ─────────────────────────────────────────────────────────────
-- Ethan has NO date of birth — the common shape for a coach-added walk-in, and
-- precisely why students_identity_uniq lets a duplicate through unnoticed.
INSERT INTO students (id, full_name, date_of_birth, tenant_id, assignment_status,
                      is_active, provisional_contact_phone)
VALUES
  ('c1a99999-0000-0000-0000-000000000001','Ethan Tan Wei Ming', NULL,
   'c1a11111-0000-0000-0000-000000000001','unassigned', TRUE, '91112222'),
  ('c1a99999-0000-0000-0000-000000000002','Sophia Lim','2019-03-04',
   'c1a11111-0000-0000-0000-000000000001','unassigned', TRUE, NULL),
  -- Shares ONLY a surname with Ethan. Must never surface on a "Tan" search.
  ('c1a99999-0000-0000-0000-000000000003','Bernice Tan','2018-05-06',
   'c1a11111-0000-0000-0000-000000000001','unassigned', TRUE, NULL),
  -- Already has a parent, so never a candidate.
  ('c1a99999-0000-0000-0000-000000000004','Claimed Child','2017-01-02',
   'c1a11111-0000-0000-0000-000000000001','unassigned', TRUE, NULL);

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c1a99999-0000-0000-0000-000000000004'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
 WHERE pr.email = 'claim-p1@test.local';

-- One marked lesson for Ethan, so the candidate card has a date to show.
INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('c1a77777-0000-0000-0000-000000000001','c1a55555-0000-0000-0000-000000000001','2026-07-11');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('c1a77777-0000-0000-0000-000000000001','c1a99999-0000-0000-0000-000000000001',
        'trial_free','c1000000-0000-0000-0000-0000000000c1');

-- ══ find_student_candidates: the disclosure surface ════════════════════════
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT * FROM find_student_candidates('c1a11111-0000-0000-0000-000000000001','Ethan',NULL) $$,
  '42501', NULL, 'anon has no EXECUTE on find_student_candidates');
RESET ROLE;

SET LOCAL ROLE authenticated;

-- 2. A parent who has not joined the business is REFUSED, not handed an empty
--    set. An empty set is indistinguishable from a business with no children.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000d3","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM find_student_candidates('c1a11111-0000-0000-0000-000000000001','Ethan',NULL) $$,
  'you have not joined that business',
  'a parent who has NOT joined the business is refused outright');

-- 3. An admin is not a parent, and this is a parent-only tool.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM find_student_candidates('c1a11111-0000-0000-0000-000000000001','Ethan',NULL) $$,
  'only a parent can look for their own child',
  'an admin cannot use the parent-facing candidate lookup');

-- ── P1: the phone parent ───────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- 4. The given name alone finds the child — the nickname case this exists for.
SELECT is(
  (SELECT count(*)::INT FROM find_student_candidates(
     'c1a11111-0000-0000-0000-000000000001','Ethan',NULL)
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000001'),
  1, '"Ethan" finds "Ethan Tan Wei Ming" — first-token match');

-- 5. Masking: the given name survives, every other token becomes an initial.
SELECT is(
  (SELECT masked_name FROM find_student_candidates(
     'c1a11111-0000-0000-0000-000000000001','Ethan',NULL)
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000001'),
  'Ethan T. W. M.',
  'the candidate is masked — the family name never leaves the database');

-- 8. The phone signal finds the child even when the NAME matches nothing.
--    This is why P1 cannot be used for the zero-count assertions below.
SELECT is(
  (SELECT match_reason FROM find_student_candidates(
     'c1a11111-0000-0000-0000-000000000001','Completely Different Name',NULL)
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000001'),
  'phone', 'a matching phone number finds the child even when the name does not');

-- 9. The card carries the lesson date the parent will recognise.
SELECT is(
  (SELECT last_lesson FROM find_student_candidates(
     'c1a11111-0000-0000-0000-000000000001','Ethan',NULL)
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000001'),
  '2026-07-11'::date, 'the candidate card shows when they last attended');

-- ── P2: pure name matching, no phone ──────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

-- 6. ⚠ THE DISCLOSURE ASSERTION. A surname alone must match NOTHING, or the
--    popup turns into a list of the business's unclaimed children.
SELECT is(
  (SELECT count(*)::INT FROM find_student_candidates(
     'c1a11111-0000-0000-0000-000000000001','Tan',NULL)),
  0, 'a SURNAME-ONLY overlap returns nothing — not a directory');

-- ⚠ A CONFLICTING DATE OF BIRTH DISQUALIFIES A NAME MATCH (added 2026-07-26).
-- Bernice Tan was born 2018-05-06. A parent typing that same name with a
-- DIFFERENT birthday is describing a namesake, not this child — and before
-- this rule the given name alone was enough to surface her. The admin's
-- duplicate detector already refused this case, so the parent-facing matcher
-- (the one a stranger with a join code reaches) was the LOOSER of the two.
SELECT is(
  (SELECT count(*)::INT FROM find_student_candidates(
     'c1a11111-0000-0000-0000-000000000001','Bernice Tan','2011-11-11')),
  0, '⚠ a name match is refused when both dates of birth are known and differ');

-- ...but a MISSING date is not a conflicting one, and that is the whole
-- feature: the coach-added child usually has no date at all, which is exactly
-- why students_identity_uniq lets the duplicate through.
SELECT is(
  (SELECT count(*)::INT FROM find_student_candidates(
     'c1a11111-0000-0000-0000-000000000001','Bernice Tan', NULL)),
  1, 'a MISSING date of birth still matches — it is not a disagreement');

-- 7. A child who already has a parent is never offered.
SELECT is(
  (SELECT count(*)::INT FROM find_student_candidates(
     'c1a11111-0000-0000-0000-000000000001','Claimed Child','2017-01-02')),
  0, 'a child who already has a parent is never a candidate');

-- ══ add_child_or_claim ════════════════════════════════════════════════════
-- 10-12. THE TRIPWIRE. A child matching nothing must be created exactly as the
--        plain INSERT used to — a parent whose child is genuinely new must not
--        be able to tell this slice shipped.
SELECT is(
  (SELECT outcome FROM add_child_or_claim(
     'c1a11111-0000-0000-0000-000000000001','Brand New Child','2020-08-08','male',NULL,'check',NULL)),
  'created', 'a child matching nothing is created, exactly as before');

SELECT is(
  (SELECT (s.assignment_status::text, s.is_active, s.tenant_id, s.created_by)
     FROM students s WHERE s.full_name = 'Brand New Child'),
  ('unassigned'::text, TRUE, 'c1a11111-0000-0000-0000-000000000001'::uuid,
   'c1000000-0000-0000-0000-0000000000d2'::uuid),
  'the created row has the same shape the app used to insert');

SELECT is(
  (SELECT count(*)::INT FROM parent_students ps
     JOIN students s ON s.id = ps.student_id
    WHERE s.full_name = 'Brand New Child'),
  1, 'and it is linked to the parent who created it');

-- 13-14. A MATCH creates nothing and returns the candidates.
SELECT is(
  (SELECT outcome FROM add_child_or_claim(
     'c1a11111-0000-0000-0000-000000000001','Ethan','2019-01-01',NULL,NULL,'check',NULL)),
  'candidates', 'a matching name returns candidates instead of creating');

SELECT is(
  (SELECT count(*)::INT FROM students WHERE full_name = 'Ethan'),
  0, 'and INSERTS NOTHING — the parent has not answered yet');

-- 15. A parent cannot claim a student that is not one of their candidates.
SELECT throws_ok(
  $$ SELECT * FROM add_child_or_claim(
       'c1a11111-0000-0000-0000-000000000001','Ethan','2019-01-01',NULL,NULL,
       'claim_confirmed','c1a99999-0000-0000-0000-000000000004') $$,
  'that child is not one you can claim',
  'a parent cannot claim an arbitrary student id they guessed');

-- 19. A NULL-dob child with no match is created (sets up assertion 21).
SELECT is(
  (SELECT outcome FROM add_child_or_claim(
     'c1a11111-0000-0000-0000-000000000001','No Dob Child',NULL,NULL,NULL,'check',NULL)),
  'created', 'a NULL-dob child with no match is created');

-- 20-21. Not Sure files a claim too, and then blocks a re-add.
SELECT is(
  (SELECT outcome FROM add_child_or_claim(
     'c1a11111-0000-0000-0000-000000000001','Sophia','2019-03-04',NULL,NULL,
     'claim_unsure','c1a99999-0000-0000-0000-000000000002')),
  'pending', 'Not Sure files a claim for the admin to decide');

SELECT is(
  (SELECT outcome FROM add_child_or_claim(
     'c1a11111-0000-0000-0000-000000000001','Sophia','2019-03-04',NULL,NULL,'check',NULL)),
  'already_pending', 'while a claim is pending the parent cannot re-add that child');

-- 22. ⚠ THE NULL-DOB BLOCK. Half the children this feature exists for have no
--     date of birth. With `=` instead of IS NOT DISTINCT FROM the predicate
--     evaluates to NULL, the block silently never fires, and the duplicate
--     this whole slice exists to prevent comes straight back.
SELECT is(
  (SELECT outcome FROM add_child_or_claim(
     'c1a11111-0000-0000-0000-000000000001','Ethan Tan',NULL,NULL,NULL,
     'claim_confirmed','c1a99999-0000-0000-0000-000000000001')),
  'pending', 'a claim can be filed with NO date of birth');

SELECT is(
  (SELECT outcome FROM add_child_or_claim(
     'c1a11111-0000-0000-0000-000000000001','Ethan Tan',NULL,NULL,NULL,'check',NULL)),
  'already_pending', '⚠ and the block still fires when the dob is NULL on both sides');

-- ── P1 files a competing claim on the same child (RISK 6) ─────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT is(
  (SELECT outcome FROM add_child_or_claim(
     'c1a11111-0000-0000-0000-000000000001','Ethan','2019-01-01',NULL,NULL,
     'claim_confirmed','c1a99999-0000-0000-0000-000000000001')),
  'pending', 'a SECOND parent can also file a claim on the same child');

SELECT is(
  (SELECT count(*)::INT FROM parent_students
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000001'),
  0, '⚠ Confirm does NOT attach the child — the admin decides every link');

-- ══ RLS on student_claims ═════════════════════════════════════════════════
-- 26. One parent cannot see the other's claim on the very same child.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::INT FROM student_claims
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000001'),
  1, 'a parent sees only their OWN claim on a child two parents have claimed');

-- 27. The admin of ANOTHER business sees nothing.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::INT FROM student_claims),
  0, 'another business''s admin cannot see this business''s claims');

-- 28. The owning business's admin sees all three.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::INT FROM student_claims WHERE status = 'pending'),
  3, 'the business''s own admin sees every pending claim');

-- ══ approve / decline / undo ══════════════════════════════════════════════
-- 29. A parent cannot approve their own claim.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM approve_student_claim(
       (SELECT sc.id FROM student_claims sc
         JOIN parents p ON p.id = sc.parent_id
         JOIN profiles pr ON pr.id = p.profile_id
        WHERE sc.student_id='c1a99999-0000-0000-0000-000000000001'
          AND pr.email='claim-p1@test.local')) $$,
  'only this business''s admin may decide a claim',
  'a parent cannot approve their own claim');

SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 30. Approving links the child AND closes the competing claim, so the admin
--     never clicks a second button that has silently become impossible.
SELECT is(
  (SELECT others_declined FROM approve_student_claim(
     (SELECT sc.id FROM student_claims sc
       JOIN parents p ON p.id = sc.parent_id
       JOIN profiles pr ON pr.id = p.profile_id
      WHERE sc.student_id='c1a99999-0000-0000-0000-000000000001'
        AND pr.email='claim-p1@test.local'))),
  1, 'approving one claim auto-declines the other claim on that child');

SELECT is(
  (SELECT count(*)::INT FROM parent_students
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000001'),
  1, 'the child is now attached to exactly one parent');

-- 32. The missing date of birth is filled from what the parent typed — the one
--     thing that stops this same duplicate forming all over again.
SELECT is(
  (SELECT date_of_birth FROM students WHERE id = 'c1a99999-0000-0000-0000-000000000001'),
  '2019-01-01'::date, 'approval fills the child''s MISSING date of birth');

-- 33-34. Undo. Without it a mis-approval is permanent: parent_students_delete
--        covers the parent and the platform admin, never the business's admin.
SELECT lives_ok(
  $$ SELECT undo_student_claim(
       (SELECT id FROM student_claims
         WHERE student_id='c1a99999-0000-0000-0000-000000000001'
           AND status='approved')) $$,
  'the admin can undo an approval they got wrong');

SELECT is(
  (SELECT count(*)::INT FROM parent_students
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000001'),
  0, 'undo detaches the child again');

-- ══ The queue reader, and the RLS hole it exists to close ═════════════════
-- ⚠ REGRESSION PIN. The admin page originally embedded
-- parents(profiles(...)) and showed "—" for the name, email and phone of
-- EVERY requester: profiles_select reaches a parent through
-- tenant_serves_parent(), which goes via their children's enrolments, and a
-- parent who has joined by code but has no child yet is served by nobody —
-- exactly the parent who files a claim. Every RPC was correct; the hole was in
-- the page's read path, and only the UI driver found it.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(
  (SELECT parent_email FROM list_student_claims()
    WHERE student_id = 'c1a99999-0000-0000-0000-000000000002'),
  'claim-p2@test.local',
  '⚠ the admin can see WHO is asking — a plain profiles join returns NULL here');

-- ...and it is still scoped per claim, so another business sees nothing.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::INT FROM list_student_claims()),
  0, 'another business''s admin gets no rows from the queue reader');

-- ══ The contract: a parent has no direct INSERT any more ══════════════════
-- ⚠ THIS IS WHAT MAKES THE WHOLE SLICE REAL. add_child_or_claim() checks for
-- an existing roster entry before creating a child; if a parent could still
-- INSERT into `students` directly, that check would live only in the client,
-- and §7.8 is unambiguous — a safety gate the only live caller can bypass is
-- not a gate. If this assertion ever fails, the duplicate prevention is
-- decorative.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
SELECT throws_ok(
  $$ INSERT INTO students (full_name, date_of_birth, tenant_id, assignment_status, is_active)
     VALUES ('Sneaked Past The Check','2020-01-01',
             'c1a11111-0000-0000-0000-000000000001','unassigned', TRUE) $$,
  '42501', NULL,
  '⚠ a parent can no longer INSERT a child directly — the check cannot be skipped');

-- ...and the admin's own path is untouched, which is the half a careless
-- narrowing would have broken.
SET LOCAL "request.jwt.claims" TO '{"sub":"c1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok(
  $$ INSERT INTO students (full_name, date_of_birth, tenant_id, assignment_status, is_active)
     VALUES ('Admin Added Child','2020-02-02',
             'c1a11111-0000-0000-0000-000000000001','unassigned', TRUE) $$,
  'the business''s admin can still add a child directly');

SELECT * FROM finish();
ROLLBACK;
