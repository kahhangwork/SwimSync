-- pgTAP: TENANT SUSPENSION (20260813000300, Wave 5 chunk 3).
--
-- WHAT EACH BLOCK PROVES:
--   1. Fixture controls: two tenants, staff, a TWO-TENANT parent; the
--      predicate answers FALSE for NULL and unknown ids (⚠ RISK 10); the
--      direct parent_tenants INSERT path is CLOSED (20260804000500 — the
--      plan's ⚠ RISK 2 (review) path no longer exists; pinned here).
--   2. Positive controls (§7.16): every read the dark matrix later asserts on
--      is LIT first — 2 rows each (one per tenant) for the parent, real
--      authority for the staff. "Dark" later means suspension did it.
--   3. Guard + gates: suspended_at is not client-writable; tenant admin and
--      parent are refused on both RPCs; unknown tenant refused.
--   4. THE SUSPEND, by the platform admin. Audit row on chunk 1's 'Tenant'
--      arm, idempotent re-run writes no second row.
--   5. THE DARK MATRIX (⚠ RISK 1: the test list IS the enumeration — one case
--      per live policy arm, derived from pg_policies 2026-08-13, THREE more
--      than the plan named): students (owns-arm AND created_by arm),
--      students_update (write arm), attendance, enrolments, trial_bookings,
--      makeup_bookings, classes, sessions, invoices, invoice_items,
--      payment_records, credit_notes, credit_applications, parent_packages
--      (select, update, insert), package_applications, parent_tenants,
--      parent_tenant_balances, student_claims, parent_students — the
--      two-tenant parent KEEPS every one of these on their other business.
--   6. RPC gates: claim_invoice_paid refuses the suspended tenant's invoice,
--      lives on the other tenant's; join_tenant_by_code refuses a
--      previously-inactivated family re-entering with the GENERIC wording
--      (⚠ RISK 6 — the rejoin path is the ON CONFLICT reactivation arm), and
--      the membership stays inactive.
--   7. Staff dark: is_tenant_admin() and current_coach_id() both cut — and
--      the current_tenant_id() residue pinned as EXPECTED (⚠ RISK 5:
--      accepted, token-lifetime, the auth-layer ban is the enforcement).
--   8. The platform admin keeps FULL access (oversight + the exit door), and
--      the overview reports the new suspended_at column.
--   9. Unsuspend: parent, admin and coach all return; idempotent; audited.
--  10. Chunk 2 re-run (⚠ RISK 2 of the wave): current_coach_id() was edited
--      by BOTH chunks — a coach disabled in a NON-suspended tenant still
--      resolves NULL, proving the disabled_at clause survived this chunk's
--      edit.
--  11. anon holds EXECUTE on none of the three new functions.
--
-- PROVEN RED (§7.25), TEN measured sabotages, all run 2026-08-13:
--   • tenant_suspended() body replaced with SELECT FALSE (predicate dead):
--     19 fail — 36 and the whole dark matrix 38–55 — and then the suite
--     ABORTS at the package-cancel probe ("Only the business can cancel an
--     active package"): the S row became VISIBLE and the probe reached the
--     lifecycle trigger. The abort is the update-arm detection firing, and it
--     is why the refusal cases after it show as errors, not "not ok".
--   • is_tenant_admin() suspension clause removed: 66,67 (the admin keeps
--     reading a suspended tenant).
--   • current_coach_id() suspension clause removed (disabled_at kept):
--     69,70 — and 85 stayed GREEN, isolating the two clauses from each other.
--   • parent_owns_student() suspension clause removed: 38–42,55,65 — 55
--     proves parent_students_select really delegates to this helper (its
--     first draft used an inline subselect on students, which the caller's
--     own RLS blinds post-suspension: the subselect returns NULL,
--     tenant_suspended(NULL) is FALSE, and the arm PASSES — found red by
--     this suite, fixed to the delegation before commit), and 65 is the
--     write probe landing on the owns-arm child.
--   • parent_has_child_in_class() tenant gate removed: 43,44.
--   • join_tenant_by_code() suspension refusal removed: 62,64 — the rejoin
--     LANDS and the ON CONFLICT arm reactivates the membership (⚠ RISK 6 is
--     real).
--   • claim_invoice_paid() gate removed: exactly 58.
--   • guard_tenants_owner() reverted to the chunk-1 body: 28,31,32,37,75 —
--     the client write LANDS and suspends S EARLY, so the coach's positive
--     controls go dark (31,32) and the real suspend becomes a no-op that
--     writes no audit row (37,75). A one-line guard omission cascades.
--   • invoices_select parent arm clause removed: EXACTLY 45 — each matrix
--     case measures its own arm, none rides the helpers (the one-to-one
--     mapping ⚠ RISK 1 demands).
--   • parent_in_tenant() suspension clause removed: 56,60,61 directly (the
--     add-child RPC LANDS, the tenant row and the product reappear — 56 falls
--     through to the WITH CHECK's own 42501, the layered wall) and 72,82
--     downstream: test 60's landed insert leaves an extra S student that the
--     platform admin and the unsuspended admin then miscount. A missed choke
--     point does not stay contained.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(88);

-- ── Fixture ──────────────────────────────────────────────────────────────────
-- Tenant S ("Suspend School") is suspended mid-suite. Tenant K ("Keep
-- School") never is — it is the two-tenant parent's other business, the
-- control every dark assertion is measured against.
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('e5aa0000-0000-0000-0000-000000000001','ts-suspend','Suspend School','SWIM-TSSA'),
  ('e5bb0000-0000-0000-0000-000000000001','ts-keep','Keep School','SWIM-TSSB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  -- S: owner-admin SA, pure coach SC
  ('00000000-0000-0000-0000-000000000000','e5aa0000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','ts-s-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Suspend Admin","role":"tenant_admin","tenant_id":"e5aa0000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','e5aa0000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','ts-s-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Suspend Coach","role":"coach","tenant_id":"e5aa0000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  -- K: owner-admin KA, active coach KC, and KC2 — disabled later (chunk 2 re-run)
  ('00000000-0000-0000-0000-000000000000','e5bb0000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','ts-k-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Keep Admin","role":"tenant_admin","tenant_id":"e5bb0000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','e5bb0000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','ts-k-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Keep Coach","role":"coach","tenant_id":"e5bb0000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','e5bb0000-0000-0000-0000-0000000000c2',
   'authenticated','authenticated','ts-k-coach2@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Keep Coach Two","role":"coach","tenant_id":"e5bb0000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  -- P2: the two-tenant parent. P3: a formerly-active family of S (rejoin case).
  ('00000000-0000-0000-0000-000000000000','e5cc0000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','ts-parent2@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','e5cc0000-0000-0000-0000-0000000000d2',
   'authenticated','authenticated','ts-parent3@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{}', now(), now(), '', '', '', ''),
  -- The platform admin.
  ('00000000-0000-0000-0000-000000000000','e5cc0000-0000-0000-0000-0000000000e1',
   'authenticated','authenticated','ts-platform@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Platform Pat","role":"platform_admin"}', now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE t.id IN ('e5aa0000-0000-0000-0000-000000000001','e5bb0000-0000-0000-0000-000000000001')
   AND NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- Classes: SX/SY in S (coach SC), KX/KY in K (coach KC). Saturday throughout;
-- 2026-08-01 is a Saturday.
-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'e5aa0000-0000-0000-0000-000000000011', c.id, 'Suspend Lane','saturday','09:00','10:00',(SELECT l.id FROM locations l WHERE l.tenant_id = c.tenant_id AND lower(trim(l.name)) = 'default location'),40,
       (SELECT cc.id FROM class_categories cc WHERE cc.tenant_id=c.tenant_id AND lower(trim(cc.name))='default group')
  FROM coaches c WHERE c.profile_id='e5aa0000-0000-0000-0000-0000000000c1';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'e5aa0000-0000-0000-0000-000000000012', c.id, 'Suspend Makeup Lane','saturday','11:00','12:00',(SELECT l.id FROM locations l WHERE l.tenant_id = c.tenant_id AND lower(trim(l.name)) = 'default location'),40,
       (SELECT cc.id FROM class_categories cc WHERE cc.tenant_id=c.tenant_id AND lower(trim(cc.name))='default group')
  FROM coaches c WHERE c.profile_id='e5aa0000-0000-0000-0000-0000000000c1';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'e5bb0000-0000-0000-0000-000000000011', c.id, 'Keep Lane','saturday','09:00','10:00',(SELECT l.id FROM locations l WHERE l.tenant_id = c.tenant_id AND lower(trim(l.name)) = 'default location'),40,
       (SELECT cc.id FROM class_categories cc WHERE cc.tenant_id=c.tenant_id AND lower(trim(cc.name))='default group')
  FROM coaches c WHERE c.profile_id='e5bb0000-0000-0000-0000-0000000000c1';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'e5bb0000-0000-0000-0000-000000000012', c.id, 'Keep Makeup Lane','saturday','11:00','12:00',(SELECT l.id FROM locations l WHERE l.tenant_id = c.tenant_id AND lower(trim(l.name)) = 'default location'),40,
       (SELECT cc.id FROM class_categories cc WHERE cc.tenant_id=c.tenant_id AND lower(trim(cc.name))='default group')
  FROM coaches c WHERE c.profile_id='e5bb0000-0000-0000-0000-0000000000c1';

-- Students: PS2 (S, linked to P2), SCr (S, CREATED BY P2, deliberately NO
-- parent_students link — it isolates the created_by arm), PK (K, linked).
INSERT INTO students (id, full_name, assignment_status, tenant_id, created_by) VALUES
  ('e5aa0000-0000-0000-0000-000000000021','Suspend Kid','assigned','e5aa0000-0000-0000-0000-000000000001',NULL),
  ('e5aa0000-0000-0000-0000-000000000022','Suspend Selfadd','unassigned','e5aa0000-0000-0000-0000-000000000001','e5cc0000-0000-0000-0000-0000000000d1'),
  ('e5bb0000-0000-0000-0000-000000000021','Keep Kid','assigned','e5bb0000-0000-0000-0000-000000000001',NULL);

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.sid FROM parents p,
  (VALUES ('e5aa0000-0000-0000-0000-000000000021'::uuid),
          ('e5bb0000-0000-0000-0000-000000000021'::uuid)) AS s(sid)
 WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, t.tid FROM parents p,
  (VALUES ('e5aa0000-0000-0000-0000-000000000001'::uuid),
          ('e5bb0000-0000-0000-0000-000000000001'::uuid)) AS t(tid)
 WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';
-- P3 was a member of S once, and left.
INSERT INTO parent_tenants (parent_id, tenant_id, is_active, inactivated_at)
SELECT p.id, 'e5aa0000-0000-0000-0000-000000000001', FALSE, now()
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d2';

INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('e5aa0000-0000-0000-0000-000000000021','e5aa0000-0000-0000-0000-000000000011', TRUE),
  ('e5bb0000-0000-0000-0000-000000000021','e5bb0000-0000-0000-0000-000000000011', TRUE);

INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
  ('e5aa0000-0000-0000-0000-000000000031','e5aa0000-0000-0000-0000-000000000011','2026-08-01','completed'),
  ('e5bb0000-0000-0000-0000-000000000031','e5bb0000-0000-0000-0000-000000000011','2026-08-01','completed');

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('e5aa0000-0000-0000-0000-000000000031','e5aa0000-0000-0000-0000-000000000021','present','e5aa0000-0000-0000-0000-0000000000c1'),
  ('e5bb0000-0000-0000-0000-000000000031','e5bb0000-0000-0000-0000-000000000021','present','e5bb0000-0000-0000-0000-0000000000c1');

-- One trial and one make-up per tenant, both P2's children — they feed
-- parent_owns_student (their own selects) AND parent_has_child_in_class (the
-- classes/sessions arms).
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
SELECT 'e5aa0000-0000-0000-0000-000000000001','e5aa0000-0000-0000-0000-000000000021',
       'e5aa0000-0000-0000-0000-000000000011','2026-08-15',
       (SELECT id FROM class_categories WHERE tenant_id='e5aa0000-0000-0000-0000-000000000001' AND lower(trim(name))='default group'),
       'e5aa0000-0000-0000-0000-0000000000a1';
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
SELECT 'e5bb0000-0000-0000-0000-000000000001','e5bb0000-0000-0000-0000-000000000021',
       'e5bb0000-0000-0000-0000-000000000011','2026-08-15',
       (SELECT id FROM class_categories WHERE tenant_id='e5bb0000-0000-0000-0000-000000000001' AND lower(trim(name))='default group'),
       'e5bb0000-0000-0000-0000-0000000000a1';
INSERT INTO makeup_bookings (tenant_id, student_id, class_id, session_date, category_id, home_class_id, booked_by)
SELECT 'e5aa0000-0000-0000-0000-000000000001','e5aa0000-0000-0000-0000-000000000021',
       'e5aa0000-0000-0000-0000-000000000012','2026-08-15',
       (SELECT id FROM class_categories WHERE tenant_id='e5aa0000-0000-0000-0000-000000000001' AND lower(trim(name))='default group'),
       'e5aa0000-0000-0000-0000-000000000011','e5aa0000-0000-0000-0000-0000000000a1';
INSERT INTO makeup_bookings (tenant_id, student_id, class_id, session_date, category_id, home_class_id, booked_by)
SELECT 'e5bb0000-0000-0000-0000-000000000001','e5bb0000-0000-0000-0000-000000000021',
       'e5bb0000-0000-0000-0000-000000000012','2026-08-15',
       (SELECT id FROM class_categories WHERE tenant_id='e5bb0000-0000-0000-0000-000000000001' AND lower(trim(name))='default group'),
       'e5bb0000-0000-0000-0000-000000000011','e5bb0000-0000-0000-0000-0000000000a1';

-- Money rows, one full chain per tenant: invoice → item → payment record →
-- credit note → credit application; a package product → purchase →
-- application; a balance row; a claim. Reference triggers fill the numbers.
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT 'e5aa0000-0000-0000-0000-000000000001','e5aa0000-0000-0000-0000-000000000051', p.id,'2026-07',40,0,40,'outstanding'
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT 'e5bb0000-0000-0000-0000-000000000001','e5bb0000-0000-0000-0000-000000000051', p.id,'2026-07',40,0,40,'outstanding'
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';
INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date) VALUES
  ('e5aa0000-0000-0000-0000-000000000061','e5aa0000-0000-0000-0000-000000000051',
   'e5aa0000-0000-0000-0000-000000000021','e5aa0000-0000-0000-0000-000000000031','present',40,'Suspend Lane','2026-08-01'),
  ('e5bb0000-0000-0000-0000-000000000061','e5bb0000-0000-0000-0000-000000000051',
   'e5bb0000-0000-0000-0000-000000000021','e5bb0000-0000-0000-0000-000000000031','present',40,'Keep Lane','2026-08-01');
INSERT INTO payment_records (invoice_id, marked_by) VALUES
  ('e5aa0000-0000-0000-0000-000000000051','e5aa0000-0000-0000-0000-0000000000a1'),
  ('e5bb0000-0000-0000-0000-000000000051','e5bb0000-0000-0000-0000-0000000000a1');
INSERT INTO credit_notes (tenant_id, id, reference_number, parent_id, student_id, invoice_id, invoice_item_id,
  lesson_session_id, amount, original_status, corrected_status, status)
SELECT 'e5aa0000-0000-0000-0000-000000000001','e5aa0000-0000-0000-0000-000000000071','CN-TS-0001', p.id,
       'e5aa0000-0000-0000-0000-000000000021','e5aa0000-0000-0000-0000-000000000051',
       'e5aa0000-0000-0000-0000-000000000061','e5aa0000-0000-0000-0000-000000000031',
       40,'present','absent','available'
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';
INSERT INTO credit_notes (tenant_id, id, reference_number, parent_id, student_id, invoice_id, invoice_item_id,
  lesson_session_id, amount, original_status, corrected_status, status)
SELECT 'e5bb0000-0000-0000-0000-000000000001','e5bb0000-0000-0000-0000-000000000071','CN-TS-0002', p.id,
       'e5bb0000-0000-0000-0000-000000000021','e5bb0000-0000-0000-0000-000000000051',
       'e5bb0000-0000-0000-0000-000000000061','e5bb0000-0000-0000-0000-000000000031',
       40,'present','absent','available'
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';
INSERT INTO credit_applications (credit_note_id, invoice_id, amount) VALUES
  ('e5aa0000-0000-0000-0000-000000000071','e5aa0000-0000-0000-0000-000000000051',10),
  ('e5bb0000-0000-0000-0000-000000000071','e5bb0000-0000-0000-0000-000000000051',10);
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_months)
SELECT 'e5aa0000-0000-0000-0000-000000000081','e5aa0000-0000-0000-0000-000000000001','10 Suspend Lessons',
       (SELECT id FROM class_categories WHERE tenant_id='e5aa0000-0000-0000-0000-000000000001' AND lower(trim(name))='default group'),10,40.00,12;
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_months)
SELECT 'e5bb0000-0000-0000-0000-000000000081','e5bb0000-0000-0000-0000-000000000001','10 Keep Lessons',
       (SELECT id FROM class_categories WHERE tenant_id='e5bb0000-0000-0000-0000-000000000001' AND lower(trim(name))='default group'),10,40.00,12;
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status)
SELECT 'e5aa0000-0000-0000-0000-000000000091','e5aa0000-0000-0000-0000-000000000001', p.id,
       'e5aa0000-0000-0000-0000-000000000081','active'
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status)
SELECT 'e5bb0000-0000-0000-0000-000000000091','e5bb0000-0000-0000-0000-000000000001', p.id,
       'e5bb0000-0000-0000-0000-000000000081','active'
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';
INSERT INTO package_applications (parent_package_id, invoice_item_id, amount) VALUES
  ('e5aa0000-0000-0000-0000-000000000091','e5aa0000-0000-0000-0000-000000000061',10),
  ('e5bb0000-0000-0000-0000-000000000091','e5bb0000-0000-0000-0000-000000000061',10);
INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
SELECT p.id, t.tid, 5 FROM parents p,
  (VALUES ('e5aa0000-0000-0000-0000-000000000001'::uuid),
          ('e5bb0000-0000-0000-0000-000000000001'::uuid)) AS t(tid)
 WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1'
ON CONFLICT DO NOTHING;
INSERT INTO student_claims (tenant_id, student_id, parent_id, claimed_name, certainty, match_reason)
SELECT 'e5aa0000-0000-0000-0000-000000000001','e5aa0000-0000-0000-0000-000000000022', p.id,'Suspend Selfadd','unsure','name'
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';
INSERT INTO student_claims (tenant_id, student_id, parent_id, claimed_name, certainty, match_reason)
SELECT 'e5bb0000-0000-0000-0000-000000000001','e5bb0000-0000-0000-0000-000000000021', p.id,'Keep Kid','unsure','name'
  FROM parents p WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d1';

-- An admin-read subject for the staff-dark block.
INSERT INTO billing_periods (tenant_id, billing_month, invoices_issued)
VALUES ('e5aa0000-0000-0000-0000-000000000001','2026-07',1);

-- ============================================================
-- 1. FIXTURE CONTROLS + THE PREDICATE + THE CLOSED INSERT PATH
-- ============================================================

-- 1
SELECT is(
  (SELECT COUNT(*) FROM profiles WHERE id IN
    ('e5aa0000-0000-0000-0000-0000000000a1','e5aa0000-0000-0000-0000-0000000000c1',
     'e5bb0000-0000-0000-0000-0000000000a1','e5bb0000-0000-0000-0000-0000000000c1',
     'e5bb0000-0000-0000-0000-0000000000c2','e5cc0000-0000-0000-0000-0000000000d1',
     'e5cc0000-0000-0000-0000-0000000000d2','e5cc0000-0000-0000-0000-0000000000e1'))::int,
  8, 'control: handle_new_user built all eight fixture profiles');

-- 2
SELECT is(
  (SELECT COUNT(*) FROM parents WHERE profile_id IN
    ('e5cc0000-0000-0000-0000-0000000000d1','e5cc0000-0000-0000-0000-0000000000d2'))::int,
  2, 'control: both parents hold parents rows');

-- 3
SELECT ok(
  (SELECT owner_profile_id FROM tenants WHERE id='e5aa0000-0000-0000-0000-000000000001')
    = 'e5aa0000-0000-0000-0000-0000000000a1'::uuid
  AND (SELECT owner_profile_id FROM tenants WHERE id='e5bb0000-0000-0000-0000-000000000001')
    = 'e5bb0000-0000-0000-0000-0000000000a1'::uuid,
  'control: each tenant''s first admin claimed ownership');

-- 4. ⚠ RISK 10 — NULL and unknown ids read FALSE, never NULL.
SELECT ok(
  tenant_suspended(NULL) = FALSE
  AND tenant_suspended('00000000-0000-0000-0000-00000000dead') = FALSE,
  '⚠ RISK 10: tenant_suspended is FALSE (not NULL) for NULL and unknown ids');

-- 5
SELECT is(tenant_suspended('e5aa0000-0000-0000-0000-000000000001'), FALSE,
  'control: S is not suspended yet');

-- 6. The plan's ⚠ RISK 2 (review) path is ALREADY CLOSED — 20260804000500
--    dropped parent_tenants_insert and revoked INSERT. Pinned so a future
--    re-grant cannot silently reopen the rejoin bypass.
SELECT ok(
  NOT has_table_privilege('authenticated','public.parent_tenants','INSERT')
  AND (SELECT COUNT(*) FROM pg_policies
        WHERE tablename='parent_tenants' AND cmd='INSERT') = 0,
  'the direct parent_tenants INSERT path stays closed — join_tenant_by_code is the only re-entry');

-- ============================================================
-- 2. POSITIVE CONTROLS — the two-tenant parent reads BOTH tenants (§7.16)
-- ============================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- 7 (students: owns-arm ×2 tenants + the created_by student)
SELECT is((SELECT COUNT(*)::int FROM students), 3,
  'control: the parent reads all three children (both tenants + the self-added one)');
-- 8
SELECT is((SELECT COUNT(*)::int FROM attendance), 2,
  'control: attendance from both tenants');
-- 9
SELECT is((SELECT COUNT(*)::int FROM student_class_enrolments), 2,
  'control: enrolments from both tenants');
-- 10
SELECT is((SELECT COUNT(*)::int FROM trial_bookings), 2,
  'control: trial bookings from both tenants');
-- 11
SELECT is((SELECT COUNT(*)::int FROM makeup_bookings), 2,
  'control: make-up bookings from both tenants');
-- 12
SELECT is((SELECT COUNT(*)::int FROM classes), 4,
  'control: all four classes visible (enrolment + make-up arms, both tenants)');
-- 13
SELECT is((SELECT COUNT(*)::int FROM lesson_sessions), 2,
  'control: sessions from both tenants');
-- 14
SELECT is((SELECT COUNT(*)::int FROM invoices), 2,
  'control: invoices from both tenants');
-- 15
SELECT is((SELECT COUNT(*)::int FROM invoice_items), 2,
  'control: invoice items from both tenants');
-- 16
SELECT is((SELECT COUNT(*)::int FROM payment_records), 2,
  'control: payment records from both tenants');
-- 17
SELECT is((SELECT COUNT(*)::int FROM credit_notes), 2,
  'control: credit notes from both tenants');
-- 18
SELECT is((SELECT COUNT(*)::int FROM credit_applications), 2,
  'control: credit applications from both tenants');
-- 19
SELECT is((SELECT COUNT(*)::int FROM parent_packages), 2,
  'control: packages from both tenants');
-- 20
SELECT is((SELECT COUNT(*)::int FROM package_applications), 2,
  'control: package applications from both tenants');
-- 21
SELECT is((SELECT COUNT(*)::int FROM parent_tenants), 2,
  'control: both of the parent''s own memberships');
-- 22
SELECT is((SELECT COUNT(*)::int FROM parent_tenant_balances), 2,
  'control: balances from both tenants');
-- 23
SELECT is((SELECT COUNT(*)::int FROM student_claims), 2,
  'control: claims from both tenants');
-- 24
SELECT is((SELECT COUNT(*)::int FROM parent_students), 2,
  'control: both link rows');

-- The write probe: both S children accept an edit while S is active (the
-- owns-arm child AND the created_by child — two different USING arms).
UPDATE students SET notes = 'lit-probe'
 WHERE id IN ('e5aa0000-0000-0000-0000-000000000021','e5aa0000-0000-0000-0000-000000000022');

RESET ROLE;
-- 25
SELECT is((SELECT COUNT(*)::int FROM students WHERE notes = 'lit-probe'), 2,
  'control: the parent''s UPDATE reached both S children (owns-arm and created_by arm)');

-- ============================================================
-- 3. STAFF POSITIVE CONTROLS, THE GUARD, AND THE GATES
-- ============================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e5aa0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 26
SELECT is((SELECT COUNT(*)::int FROM students), 2,
  'control: S''s admin reads S''s two students');
-- 27
SELECT is((SELECT COUNT(*)::int FROM billing_periods), 1,
  'control: S''s admin reads S''s billing period');

-- 28. The guard: suspended_at is not client-writable, even by the owner.
SELECT throws_ok(
  $$ UPDATE tenants SET suspended_at = now()
      WHERE id = 'e5aa0000-0000-0000-0000-000000000001' $$,
  'P0001',
  'tenants.owner_profile_id / suspended_at cannot be changed by a client — use platform_reassign_owner / suspend_tenant / unsuspend_tenant (20260813000300)',
  'the guard refuses a client write to suspended_at');

-- 29. A tenant admin cannot suspend their own business…
SELECT throws_ok(
  $$ SELECT suspend_tenant('e5aa0000-0000-0000-0000-000000000001') $$,
  'P0001', 'not permitted to suspend a business',
  'a tenant admin cannot suspend');

-- 30. …nor unsuspend one.
SELECT throws_ok(
  $$ SELECT unsuspend_tenant('e5aa0000-0000-0000-0000-000000000001') $$,
  'P0001', 'not permitted to unsuspend a business',
  'a tenant admin cannot unsuspend');

-- The coach's authority is real before the suspend.
SET LOCAL "request.jwt.claims" TO '{"sub":"e5aa0000-0000-0000-0000-0000000000c1","role":"authenticated"}';
-- 31
SELECT isnt((SELECT current_coach_id()), NULL,
  'control: S''s coach resolves as a coach');
-- 32
SELECT is((SELECT COUNT(*)::int FROM classes), 2,
  'control: S''s coach reads their two classes');

-- 33. A parent is refused on the RPC too.
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT suspend_tenant('e5aa0000-0000-0000-0000-000000000001') $$,
  'P0001', 'not permitted to suspend a business',
  'a parent cannot suspend');

-- 34. Unknown tenant, as the platform admin.
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000e1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT suspend_tenant('00000000-0000-0000-0000-00000000dead') $$,
  'P0001', 'no such business',
  'an unknown tenant id is refused');

-- ============================================================
-- 4. THE SUSPEND
-- ============================================================

-- 35
SELECT lives_ok(
  $$ SELECT suspend_tenant('e5aa0000-0000-0000-0000-000000000001') $$,
  'the platform admin suspends S');

RESET ROLE;
-- 36
SELECT ok(
  (SELECT suspended_at IS NOT NULL FROM tenants WHERE id='e5aa0000-0000-0000-0000-000000000001')
  AND tenant_suspended('e5aa0000-0000-0000-0000-000000000001'),
  'suspended_at is set and the predicate answers TRUE');

-- 37
SELECT is(
  (SELECT COUNT(*)::int FROM audit_log
    WHERE action='tenant_suspended' AND entity_type='Tenant'
      AND entity_id='e5aa0000-0000-0000-0000-000000000001'
      AND tenant_id='e5aa0000-0000-0000-0000-000000000001'),
  1, 'one tenant_suspended audit row, tenant-stamped by chunk 1''s Tenant arm');

-- ============================================================
-- 5. THE DARK MATRIX — every parent arm, S gone, K KEPT (⚠ RISK 1)
-- ============================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- 38 (both S students gone — owns-arm AND created_by arm; K's kid stays)
SELECT ok(
  (SELECT COUNT(*) FROM students) = 1
  AND EXISTS (SELECT 1 FROM students WHERE id='e5bb0000-0000-0000-0000-000000000021'),
  'students: only K''s child remains (owns-arm and created_by arm both dark)');
-- 39
SELECT is((SELECT COUNT(*)::int FROM attendance), 1,
  'attendance: K only');
-- 40
SELECT is((SELECT COUNT(*)::int FROM student_class_enrolments), 1,
  'enrolments: K only');
-- 41
SELECT is((SELECT COUNT(*)::int FROM trial_bookings), 1,
  'trial bookings: K only');
-- 42
SELECT is((SELECT COUNT(*)::int FROM makeup_bookings), 1,
  'make-up bookings: K only');
-- 43
SELECT is((SELECT COUNT(*)::int FROM classes), 2,
  'classes: K''s two only');
-- 44
SELECT is((SELECT COUNT(*)::int FROM lesson_sessions), 1,
  'sessions: K only');
-- 45
SELECT is((SELECT COUNT(*)::int FROM invoices), 1,
  'invoices: K only');
-- 46
SELECT is((SELECT COUNT(*)::int FROM invoice_items), 1,
  'invoice items: K only');
-- 47
SELECT is((SELECT COUNT(*)::int FROM payment_records), 1,
  'payment records: K only');
-- 48
SELECT is((SELECT COUNT(*)::int FROM credit_notes), 1,
  'credit notes: K only');
-- 49
SELECT is((SELECT COUNT(*)::int FROM credit_applications), 1,
  'credit applications: K only');
-- 50
SELECT is((SELECT COUNT(*)::int FROM parent_packages), 1,
  'packages: K only');
-- 51
SELECT is((SELECT COUNT(*)::int FROM package_applications), 1,
  'package applications: K only');
-- 52
SELECT is((SELECT COUNT(*)::int FROM parent_tenants), 1,
  'memberships: K only');
-- 53
SELECT is((SELECT COUNT(*)::int FROM parent_tenant_balances), 1,
  'balances: K only');
-- 54
SELECT is((SELECT COUNT(*)::int FROM student_claims), 1,
  'claims: K only');
-- 55
SELECT is((SELECT COUNT(*)::int FROM parent_students), 1,
  'link rows: K only');

-- Write probes: S children (both arms) take nothing; K''s child still does.
-- The package cancel probe matches 0 rows if the update arm is dark — any
-- error here means the row was still visible.
UPDATE students SET notes = 'dark-probe'
 WHERE id IN ('e5aa0000-0000-0000-0000-000000000021','e5aa0000-0000-0000-0000-000000000022');
UPDATE students SET notes = 'k-probe'
 WHERE id = 'e5bb0000-0000-0000-0000-000000000021';
UPDATE parent_packages SET status = 'cancelled'
 WHERE id = 'e5aa0000-0000-0000-0000-000000000091';

-- 56. parent_packages_insert: refused — the refusal actually fires EARLY, in
--     the lifecycle trigger: the parent_in_tenant() cut hides the suspended
--     tenant's PRODUCT from the invoker-rights trigger's own read, so the
--     insert dies on "Unknown package product" before the WITH CHECK's
--     42501 is ever reached. Both walls are suspension-driven; this pins the
--     outer one.
SELECT throws_ok(
  $$ INSERT INTO parent_packages (tenant_id, parent_id, product_id)
     VALUES ('e5aa0000-0000-0000-0000-000000000001',
             (SELECT current_parent_id()),
             'e5aa0000-0000-0000-0000-000000000081') $$,
  '23514', 'Unknown package product.',
  'a package request into the suspended tenant is refused');

-- 57. …and still admits the other tenant.
SELECT lives_ok(
  $$ INSERT INTO parent_packages (tenant_id, parent_id, product_id)
     VALUES ('e5bb0000-0000-0000-0000-000000000001',
             (SELECT current_parent_id()),
             'e5bb0000-0000-0000-0000-000000000081') $$,
  'a package request into the OTHER tenant still lands');

-- 58. claim_invoice_paid: the suspended tenant''s invoice is refused…
SELECT throws_ok(
  $$ SELECT claim_invoice_paid('e5aa0000-0000-0000-0000-000000000051') $$,
  'P0001', 'this business is currently suspended',
  'claiming the suspended tenant''s invoice is refused');

-- 59. …the other tenant''s claim still works.
SELECT lives_ok(
  $$ SELECT claim_invoice_paid('e5bb0000-0000-0000-0000-000000000051') $$,
  'claiming the other tenant''s invoice still works');

-- 60. parent_in_tenant() — the third choke point (found in review, not the
--     plan): without it, add_child_or_claim() would still CREATE a student
--     in the suspended tenant. The refusal is the RPC''s own membership
--     wording, so a suspended business reads exactly like one never joined.
SELECT throws_ok(
  $$ SELECT * FROM add_child_or_claim('e5aa0000-0000-0000-0000-000000000001',
       'Blocked Kid', NULL, NULL, NULL, 'create_anyway', NULL) $$,
  'P0001', 'you have not joined that business',
  'a suspended tenant''s parent cannot add a child there (parent_in_tenant cut)');

-- 61. The same cut covers SEVEN read arms this suite would otherwise need
--     one-by-one (tenants, coaches, profiles, package_products,
--     class_categories, tenant_levels selects + the packages insert — all
--     resolve parent_in_tenant). The most user-visible stands in for the
--     family: the suspended BUSINESS ITSELF vanishes from the parent's app,
--     the other remains — which is also this test's own positive control.
SELECT ok(
  (SELECT COUNT(*) FROM tenants) = 1
  AND EXISTS (SELECT 1 FROM tenants WHERE id='e5bb0000-0000-0000-0000-000000000001'),
  'tenants_select: the suspended business vanishes from the parent''s tenant list');

-- ============================================================
-- 6. THE REJOIN DOOR (⚠ RISK 6) — generic wording, membership stays inactive
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000d2","role":"authenticated"}';

-- 62. The formerly-active family re-enters S''s REAL code: refused with the
--     SAME wording as an unknown code — a join code is not a suspension probe.
SELECT throws_ok(
  $$ SELECT * FROM join_tenant_by_code('SWIM-TSSA') $$,
  'P0001', 'that join code was not recognised',
  '⚠ RISK 6: rejoining a suspended tenant is refused with the generic wording');

-- 63. Another business''s code still works for them.
SELECT lives_ok(
  $$ SELECT * FROM join_tenant_by_code('SWIM-TSSB') $$,
  'the same parent can still join a different business');

RESET ROLE;
-- 64. The ON CONFLICT reactivation arm did NOT fire.
SELECT ok(
  (SELECT NOT pt.is_active FROM parent_tenants pt
     JOIN parents p ON p.id = pt.parent_id
    WHERE p.profile_id='e5cc0000-0000-0000-0000-0000000000d2'
      AND pt.tenant_id='e5aa0000-0000-0000-0000-000000000001'),
  '⚠ RISK 6: the refused rejoin left the S membership INACTIVE');

-- 65. The write probes, verified from outside RLS: S took nothing, K did,
--     the package was NOT cancelled.
SELECT ok(
  (SELECT COUNT(*) FROM students WHERE notes='dark-probe') = 0
  AND (SELECT COUNT(*) FROM students WHERE notes='k-probe') = 1
  AND (SELECT status FROM parent_packages
        WHERE id='e5aa0000-0000-0000-0000-000000000091') = 'active',
  'write arms dark: no S student took the edit, K''s did, the S package was not cancelled');

-- ============================================================
-- 7. STAFF DARK — both helper cuts, residue pinned as EXPECTED
-- ============================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e5aa0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 66
SELECT is((SELECT COUNT(*)::int FROM students), 0,
  'the suspended tenant''s admin reads ZERO students');
-- 67
SELECT is((SELECT COUNT(*)::int FROM billing_periods), 0,
  'the suspended tenant''s admin reads ZERO billing periods');
-- 68. ⚠ RISK 5, PINNED AS EXPECTED — NOT A LEAK. current_tenant_id()-scoped
--     arms stay lit for the token lifetime; the auth-layer ban applied by
--     /api/suspend-tenant is the enforcement.
SELECT is((SELECT COUNT(*)::int FROM parent_tenants
            WHERE tenant_id='e5aa0000-0000-0000-0000-000000000001'), 2,
  'EXPECTED residue (⚠ RISK 5): the admin still passes current_tenant_id()-scoped reads');

SET LOCAL "request.jwt.claims" TO '{"sub":"e5aa0000-0000-0000-0000-0000000000c1","role":"authenticated"}';
-- 69
SELECT is((SELECT current_coach_id()), NULL,
  'current_coach_id() is NULL for a suspended tenant''s coach');
-- 70
SELECT is((SELECT COUNT(*)::int FROM classes), 0,
  'the suspended tenant''s coach reads ZERO classes');
-- 71. The coach-side residue pin.
SELECT is((SELECT COUNT(*)::int FROM coaches
            WHERE tenant_id='e5aa0000-0000-0000-0000-000000000001'), 1,
  'EXPECTED residue (⚠ RISK 5): the coach still passes current_tenant_id()-scoped reads');

-- ============================================================
-- 8. THE PLATFORM ADMIN KEEPS EVERYTHING
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- 72
SELECT is((SELECT COUNT(*)::int FROM students
            WHERE tenant_id='e5aa0000-0000-0000-0000-000000000001'), 2,
  'the platform admin still reads the suspended tenant''s students');
-- 73
SELECT ok(
  (SELECT suspended_at IS NOT NULL FROM platform_tenant_overview()
    WHERE tenant_id='e5aa0000-0000-0000-0000-000000000001')
  AND (SELECT suspended_at IS NULL FROM platform_tenant_overview()
        WHERE tenant_id='e5bb0000-0000-0000-0000-000000000001'),
  'the overview reports suspended_at for S and NULL for K');
-- 74
SELECT lives_ok(
  $$ SELECT suspend_tenant('e5aa0000-0000-0000-0000-000000000001') $$,
  're-suspending is a silent no-op');

RESET ROLE;
-- 75
SELECT is(
  (SELECT COUNT(*)::int FROM audit_log WHERE action='tenant_suspended'), 1,
  'the idempotent re-run wrote no second audit row');

-- ============================================================
-- 9. UNSUSPEND — everyone comes back
-- ============================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- 76
SELECT lives_ok(
  $$ SELECT unsuspend_tenant('e5aa0000-0000-0000-0000-000000000001') $$,
  'the platform admin unsuspends S');

RESET ROLE;
-- 77
SELECT ok(
  (SELECT suspended_at IS NULL FROM tenants WHERE id='e5aa0000-0000-0000-0000-000000000001')
  AND NOT tenant_suspended('e5aa0000-0000-0000-0000-000000000001'),
  'suspended_at is cleared and the predicate answers FALSE');
-- 78
SELECT is(
  (SELECT COUNT(*)::int FROM audit_log WHERE action='tenant_unsuspended'), 1,
  'one tenant_unsuspended audit row');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000e1","role":"authenticated"}';
-- 79
SELECT lives_ok(
  $$ SELECT unsuspend_tenant('e5aa0000-0000-0000-0000-000000000001') $$,
  're-unsuspending is a silent no-op');

RESET ROLE;
-- 80
SELECT is(
  (SELECT COUNT(*)::int FROM audit_log WHERE action='tenant_unsuspended'), 1,
  'the idempotent re-run wrote no second audit row');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e5cc0000-0000-0000-0000-0000000000d1","role":"authenticated"}';
-- 81
SELECT is((SELECT COUNT(*)::int FROM invoices), 2,
  'after unsuspend the parent reads both tenants'' invoices again');

SET LOCAL "request.jwt.claims" TO '{"sub":"e5aa0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- 82
SELECT is((SELECT COUNT(*)::int FROM students), 2,
  'after unsuspend the admin reads their students again');

SET LOCAL "request.jwt.claims" TO '{"sub":"e5aa0000-0000-0000-0000-0000000000c1","role":"authenticated"}';
-- 83
SELECT isnt((SELECT current_coach_id()), NULL,
  'after unsuspend the coach resolves again');

-- ============================================================
-- 10. CHUNK 2 RE-RUN (⚠ RISK 2 of the wave) — both clauses survived
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"e5bb0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 84
SELECT lives_ok(
  $$ SELECT disable_coach((SELECT id FROM coaches WHERE profile_id='e5bb0000-0000-0000-0000-0000000000c2')) $$,
  'K''s admin disables a coach (no classes, no replacement needed)');

SET LOCAL "request.jwt.claims" TO '{"sub":"e5bb0000-0000-0000-0000-0000000000c2","role":"authenticated"}';
-- 85
SELECT is((SELECT current_coach_id()), NULL,
  '⚠ RISK 2: a DISABLED coach of a NON-suspended tenant still resolves NULL — the disabled_at clause survived this chunk''s edit');

-- 86 (their still-active colleague proves the tenant itself is fine)
SET LOCAL "request.jwt.claims" TO '{"sub":"e5bb0000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT isnt((SELECT current_coach_id()), NULL,
  'control: K''s other coach still resolves — the tenant is not suspended');

-- ============================================================
-- 11. ANON
-- ============================================================
RESET ROLE;

-- 87
SELECT is(
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('tenant_suspended','suspend_tenant','unsuspend_tenant')),
  FALSE, 'anon holds EXECUTE on none of the three new functions');

-- 88. The K-side package request (test 57) really landed — the WITH CHECK
--     probe was not a free pass.
SELECT is(
  (SELECT COUNT(*)::int FROM parent_packages
    WHERE tenant_id='e5bb0000-0000-0000-0000-000000000001'), 2,
  'control: the other-tenant package request from test 57 exists');

SELECT * FROM finish();
ROLLBACK;
