-- pgTAP: the late-buyer close (20260818001000, ⚠ plan RISK 5). A package sold
-- AFTER a day was voided still picks up the extension when it activates — the
-- convergence the retired calendar-scan had and the pure event model would lose.
-- Rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(2);

INSERT INTO tenants (id, slug, display_name, join_code, holiday_extension_days) VALUES
  ('da000000-0000-0000-0000-0000000000c1','lb','LateBuyer','SWIM-LBY', 7);
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','db000000-0000-0000-0000-0000000000c1','authenticated','authenticated','lb-admin@test.local',crypt('x',gen_salt('bf')),now(),'{"provider":"email"}','{"full_name":"LB Admin","role":"tenant_admin","is_coach":true,"tenant_id":"da000000-0000-0000-0000-0000000000c1"}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','dc000000-0000-0000-0000-0000000000c1','authenticated','authenticated','lb-parent@test.local',crypt('x',gen_salt('bf')),now(),'{"provider":"email"}','{"full_name":"LB Parent","role":"parent"}',now(),now(),'','','','');
INSERT INTO parent_tenants (parent_id, tenant_id) SELECT p.id,'da000000-0000-0000-0000-0000000000c1' FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='lb-parent@test.local';
INSERT INTO class_categories (id,tenant_id,name) VALUES ('de000000-0000-0000-0000-0000000000c1','da000000-0000-0000-0000-0000000000c1','G');
-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id,coach_id,title,day_of_week,start_time,end_time,location_id,price_per_lesson,category_id)
  SELECT 'df000000-0000-0000-0000-0000000000c1',co.id,'Mon','monday','10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'),50,'de000000-0000-0000-0000-0000000000c1' FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='lb-admin@test.local';
INSERT INTO students (id,full_name,date_of_birth,assignment_status,tenant_id,created_by) VALUES ('55000000-0000-0000-0000-0000000000c1','LB Kid','2018-05-05','assigned','da000000-0000-0000-0000-0000000000c1','db000000-0000-0000-0000-0000000000c1');
INSERT INTO parent_students (parent_id,student_id) SELECT p.id,'55000000-0000-0000-0000-0000000000c1' FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='lb-parent@test.local';
INSERT INTO student_class_enrolments (student_id,class_id,is_active,enrolled_at) VALUES ('55000000-0000-0000-0000-0000000000c1','df000000-0000-0000-0000-0000000000c1',true,'2026-03-01');
INSERT INTO lesson_sessions (id,class_id,session_date,start_time,end_time) VALUES ('12000000-0000-0000-0000-0000000000c1','df000000-0000-0000-0000-0000000000c1','2026-03-02','10:00','11:00');

-- The holiday is marked while NO package exists → nothing to extend yet.
INSERT INTO attendance (lesson_session_id,student_id,status,marked_by) VALUES ('12000000-0000-0000-0000-0000000000c1','55000000-0000-0000-0000-0000000000c1','holiday','db000000-0000-0000-0000-0000000000c1');
SELECT is((SELECT count(*)::int FROM package_holiday_extensions), 0,
  'a holiday with no package yet leaves no extension state');

-- Now the parent buys a package whose window covers that voided date.
INSERT INTO package_products (id,tenant_id,name,lesson_count,rate_per_lesson,validity_weeks) VALUES ('d0000000-0000-0000-0000-0000000000c1','da000000-0000-0000-0000-0000000000c1','20 lessons',20,30,10);
INSERT INTO parent_packages (id,tenant_id,parent_id,product_id,status,start_date)
  SELECT 'd1000000-0000-0000-0000-0000000000c1','da000000-0000-0000-0000-0000000000c1',p.id,'d0000000-0000-0000-0000-0000000000c1','active','2026-03-01' FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='lb-parent@test.local';

SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-0000000000c1'), 7,
  'activating a package over an already-voided date picks up the +7 extension');

SELECT * FROM finish();
ROLLBACK;
