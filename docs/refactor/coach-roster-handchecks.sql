-- Hand-check setup (roster Stage 4): a second class for Noah Lim, and a level
-- with two skills on Maya Tan. Loaded on top of fixtures-student-identity.sql.
DO $$
DECLARE v_class UUID; v_tenant UUID; v_second UUID; v_level UUID;
BEGIN
  SELECT id, tenant_id INTO v_class, v_tenant FROM classes WHERE title = 'Saturday Beginners';
  INSERT INTO classes (coach_id, title, day_of_week, start_time, end_time, price_per_lesson, tenant_id, category_id, location_id)
    SELECT coach_id, 'Sunday Handcheck', 'sunday', start_time, end_time, price_per_lesson, tenant_id, category_id, location_id
      FROM classes WHERE id = v_class RETURNING id INTO v_second;
  INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
    VALUES ('5e000000-0000-0000-0000-000000000004', v_second, '2026-07-01T02:00:00Z', TRUE);
  INSERT INTO tenant_levels (tenant_id, label, note) VALUES (v_tenant, 'Toddler 1', 'Water confidence') RETURNING id INTO v_level;
  INSERT INTO tenant_level_skills (level_id, label, sort_order) VALUES (v_level, 'Float', 2), (v_level, 'Blow bubbles', 1);
  UPDATE students SET level_id = v_level WHERE full_name = 'Maya Tan';
END $$;
