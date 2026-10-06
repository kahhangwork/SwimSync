-- Rollback for 20261006000500_clock_stamp_feeds.sql (Wave 7, M3). Restores the 7 pre-M3 bodies byte-identically
-- (pg_get_functiondef captures) and the two column defaults to now(). Never drops app_now()/app_today() (§7.335).
-- Run before M2's and M1's DOWNs.
-- After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000500';

ALTER TABLE public.student_class_enrolments ALTER COLUMN enrolled_at SET DEFAULT now();
ALTER TABLE public.parent_packages ALTER COLUMN requested_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.enforce_parent_package_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product package_products%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_product FROM package_products WHERE id = NEW.product_id;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_product.is_active THEN
      RAISE EXCEPTION 'That package is no longer offered.' USING ERRCODE = 'check_violation';
    END IF;

    NEW.tenant_id       := v_product.tenant_id;
    NEW.name            := v_product.name;
    NEW.category_id     := v_product.category_id;
    NEW.lesson_count    := v_product.lesson_count;
    NEW.rate_per_lesson := v_product.rate_per_lesson;
    NEW.validity_months := v_product.validity_months;
    NEW.validity_weeks  := v_product.validity_weeks;
    NEW.total_value     := v_product.lesson_count * v_product.rate_per_lesson;
    NEW.value_remaining := NEW.total_value;
    NEW.cancelled_at    := NULL;
    NEW.discount_amount    := 0;
    NEW.amount_payable     := NEW.total_value;
    NEW.referral_reward_id := NULL;
    NEW.holiday_extension_days := 0;
    NEW.cancel_extension_days  := 0;
    NEW.manual_extension_days  := 0;
    NEW.paid_claimed_at := NULL;
    NEW.superseded_by   := NULL;

    IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(NEW.tenant_id, 'packages', 'edit')) THEN
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.start_date   := NULL;
      NEW.expires_on   := NULL;
      NEW.offered_by   := NULL;
      NEW.offered_at   := NULL;
    ELSIF NEW.status = 'active' THEN
      NEW.confirmed_at := CASE WHEN current_user = 'authenticated' THEN NOW() ELSE COALESCE(NEW.confirmed_at, NOW()) END;
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.holiday_extension_days,
                                                 NEW.cancel_extension_days,
                                                 NEW.manual_extension_days);
    ELSE
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.expires_on   := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------

  IF NEW.product_id      IS DISTINCT FROM OLD.product_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id       IS DISTINCT FROM OLD.parent_id
     OR NEW.name            IS DISTINCT FROM OLD.name
     OR NEW.category_id     IS DISTINCT FROM OLD.category_id
     OR NEW.lesson_count    IS DISTINCT FROM OLD.lesson_count
     OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.total_value     IS DISTINCT FROM OLD.total_value
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months
     OR NEW.validity_weeks  IS DISTINCT FROM OLD.validity_weeks
     OR NEW.requested_at    IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION 'A package''s terms are a record of the sale and cannot be edited.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.holiday_extension_days IS DISTINCT FROM OLD.holiday_extension_days
          OR NEW.cancel_extension_days IS DISTINCT FROM OLD.cancel_extension_days
          OR NEW.manual_extension_days IS DISTINCT FROM OLD.manual_extension_days)
  THEN
    RAISE EXCEPTION 'Package extension fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.offered_by         IS DISTINCT FROM OLD.offered_by
          OR NEW.offered_at      IS DISTINCT FROM OLD.offered_at
          OR NEW.paid_claimed_at IS DISTINCT FROM OLD.paid_claimed_at
          OR NEW.superseded_by   IS DISTINCT FROM OLD.superseded_by)
  THEN
    RAISE EXCEPTION 'Offer and payment-claim fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.discount_amount    IS DISTINCT FROM OLD.discount_amount
          OR NEW.amount_payable     IS DISTINCT FROM OLD.amount_payable
          OR NEW.referral_reward_id IS DISTINCT FROM OLD.referral_reward_id)
  THEN
    RAISE EXCEPTION 'Referral discount fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND NEW.start_date IS DISTINCT FROM OLD.start_date
  THEN
    IF NOT (is_platform_admin() OR has_admin_area(OLD.tenant_id, 'packages', 'edit')) THEN
      RAISE EXCEPTION 'Only the business sets a package''s start date.'
        USING ERRCODE = 'check_violation';
    ELSIF OLD.status = 'active' THEN
      RAISE EXCEPTION 'A package''s start date is fixed once active — cancel and re-sell to change it.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.value_remaining IS DISTINCT FROM OLD.value_remaining
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION 'A package balance is moved by billing, never edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'active' THEN
      IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(OLD.tenant_id, 'packages', 'edit')) THEN
        RAISE EXCEPTION 'Only the business can confirm a package purchase.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.confirmed_at := CASE WHEN current_user = 'authenticated' THEN NOW() ELSE COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), NOW()) END;
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date, OLD.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.holiday_extension_days,
                                                 NEW.cancel_extension_days,
                                                 NEW.manual_extension_days);
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSIF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
      IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(OLD.tenant_id, 'packages', 'edit')) THEN
        RAISE EXCEPTION 'Only the business can cancel an active package.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSE
      RAISE EXCEPTION 'Illegal package status change (% -> %).', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF current_user = 'authenticated'
       AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
            OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
            OR NEW.expires_on   IS DISTINCT FROM OLD.expires_on
            OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at)
    THEN
      RAISE EXCEPTION 'Confirmation fields are set by the status transition, not edited.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.next_credit_note_ref(p_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE tenants
     SET credit_note_counter = credit_note_counter + 1
   WHERE id = p_tenant_id
  RETURNING credit_note_counter INTO v_n;

  IF v_n IS NULL THEN
    RAISE EXCEPTION 'cannot number a credit note for unknown tenant %', p_tenant_id;
  END IF;

  RETURN 'CN-' || to_char(NOW(), 'YYYY') || '-' ||
         LPAD(v_n::TEXT, GREATEST(4, length(v_n::TEXT)), '0');
END;
$function$

;

CREATE OR REPLACE FUNCTION public.enrolment_start_at(p_tenant_id uuid, p_starts_on date)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today DATE := today_sg();
  v_floor DATE := markable_floor(p_tenant_id);
BEGIN
  IF p_starts_on IS NULL OR p_starts_on = v_today THEN
    RETURN NOW();
  END IF;

  -- D6: a future start is a different feature.
  IF p_starts_on > v_today THEN
    RAISE EXCEPTION 'A class can''t start in the future — pick today or an earlier date.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- D3: earlier than the floor is unmarkable anyway.
  IF p_starts_on < v_floor THEN
    RAISE EXCEPTION 'The earliest start date allowed is %.', to_char(v_floor, 'FMDD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  -- D10: 12:00 Singapore — the UTC date and the SGT date are the same day.
  RETURN (p_starts_on + TIME '12:00') AT TIME ZONE 'Asia/Singapore';
END;
$function$

;

CREATE OR REPLACE FUNCTION public.deactivate_class(p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_title  TEXT;
  v_active BOOLEAN;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.title, c.is_active
    INTO v_tenant, v_title, v_active
    FROM classes c
   WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
    RAISE EXCEPTION 'not permitted to deactivate this class';
  END IF;

  -- Idempotent. Re-deactivating must not move deactivated_at: that date is what
  -- the engine expects lessons up to, and rewriting it would silently widen the
  -- expectation window on a class already retired.
  IF NOT v_active THEN
    RETURN;
  END IF;

  -- The three refusals, now shared with the raw-UPDATE trigger (§7.199).
  -- Called here so the refusal lands before the audit snapshot below, keeping
  -- this function's order and error messages exactly as they were.
  PERFORM assert_class_retirable(p_class_id);

  SELECT to_jsonb(c) INTO v_old FROM classes c WHERE c.id = p_class_id;

  UPDATE classes
     SET is_active      = FALSE,
         deactivated_at = NOW(),
         updated_at     = NOW()
   WHERE id = p_class_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (v_actor, 'class_deactivated', 'Class', p_class_id, v_old,
          (SELECT to_jsonb(c) FROM classes c WHERE c.id = p_class_id));
END;
$function$

;

CREATE OR REPLACE FUNCTION public.close_student_enrolment(p_student_id uuid, p_set_inactive boolean, p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_old    JSONB;
  v_left   INT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- "Gone" is a different question from "not in this class", and it has owned
  -- its own RPC since 20260719001200. That path closes every enrolment, which
  -- is correct: an open enrolment for a child who no longer attends keeps the
  -- class permanently incomplete and BLOCKS invoicing for the whole business.
  -- set_students_active() runs its own authorization.
  IF p_set_inactive THEN
    PERFORM set_students_active(ARRAY[p_student_id], FALSE);
    RETURN;
  END IF;

  -- The other half of "no default": an explicit NULL is refused, so there is no
  -- spelling of this call that means "all of them".
  IF p_class_id IS NULL THEN
    RAISE EXCEPTION
      'name the class to remove them from — a child may be in more than one';
  END IF;

  SELECT tenant_id INTO v_tenant FROM students WHERE id = p_student_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_tenant, 'operations', 'edit')
          OR coach_owns_class(p_class_id)) THEN
    RAISE EXCEPTION 'not permitted to change this student''s enrolment';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = p_student_id;

  UPDATE student_class_enrolments
     SET is_active = FALSE, unenrolled_at = NOW()
   WHERE student_id = p_student_id
     AND class_id   = p_class_id
     AND is_active;

  -- 'unassigned' means "in NO class", not "left a class". A child dropped from
  -- one of two is still assigned, and the Students page reads this column.
  SELECT count(*) INTO v_left
    FROM student_class_enrolments
   WHERE student_id = p_student_id AND is_active;

  UPDATE students
     SET assignment_status = CASE WHEN v_left = 0
                                  THEN 'unassigned'::assignment_status
                                  ELSE assignment_status END,
         updated_at        = NOW()
   WHERE id = p_student_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor, 'student_removed_from_class', 'Student', p_student_id,
          v_old || jsonb_build_object('removed_from_class_id', p_class_id),
          (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id), v_tenant);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.set_students_active(p_student_ids uuid[], p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_sid    UUID;
  v_tenant UUID;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_student_ids IS NULL OR array_length(p_student_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no students given';
  END IF;

  FOREACH v_sid IN ARRAY p_student_ids LOOP
    SELECT tenant_id INTO v_tenant FROM students WHERE id = v_sid;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'student % not found', v_sid;
    END IF;

    -- Checked BEFORE anything is closed: coach_serves_student() reads the
    -- ACTIVE enrolment, so it returns false once we have closed it.
    IF NOT (is_platform_admin() OR has_admin_area(v_tenant, 'operations', 'edit')
            OR coach_serves_student(v_sid)) THEN
      RAISE EXCEPTION 'not permitted to change this student';
    END IF;

    SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = v_sid;

    IF NOT p_active THEN
      -- Closing the enrolment is not tidiness: an open enrolment for a child who
      -- no longer attends keeps their class permanently incomplete, which BLOCKS
      -- invoice generation for the whole business (PRD §7.7). Lessons already
      -- attended still bill — billing follows attendance rows, not enrolment
      -- (§7.13).
      UPDATE student_class_enrolments
         SET is_active = FALSE, unenrolled_at = NOW()
       WHERE student_id = v_sid AND is_active;
    END IF;

    UPDATE students
       SET is_active      = p_active,
           inactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END,
           -- 'inactive' is NO LONGER written here. Assignment answers only
           -- "in a class?", and phase 6 drops the value from the enum — which
           -- would fail at RUNTIME, not migration time, if a cast survived in
           -- a function body (§7.21).
           assignment_status = CASE WHEN p_active THEN assignment_status
                                    ELSE 'unassigned'::assignment_status END,
           updated_at     = NOW()
     WHERE id = v_sid;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                           old_value, new_value, tenant_id)
    VALUES (v_actor,
            CASE WHEN p_active THEN 'student_reactivated' ELSE 'student_set_inactive' END,
            'Student', v_sid, v_old,
            (SELECT to_jsonb(s) FROM students s WHERE s.id = v_sid), v_tenant);

    -- ── The family consequence, applied per (parent, tenant) ──────────────
    -- Deactivating: a family with no active children left here is no longer a
    -- customer here. Reactivating: a child cannot be active inside an inactive
    -- family, so the family comes back with them.
    UPDATE parent_tenants pt
       SET is_active      = p_active,
           inactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END
      FROM parent_students ps
     WHERE ps.student_id = v_sid
       AND pt.parent_id  = ps.parent_id
       AND pt.tenant_id  = v_tenant
       AND pt.is_active IS DISTINCT FROM p_active
       AND (
         p_active                      -- reactivation: unconditional
         OR NOT EXISTS (               -- deactivation: only once none are left
           SELECT 1 FROM students s2
             JOIN parent_students ps2 ON ps2.student_id = s2.id
            WHERE ps2.parent_id = ps.parent_id
              AND s2.tenant_id  = v_tenant
              AND s2.is_active
         )
       );
  END LOOP;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.reassign_student_tenant(p_student_id uuid, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_old    JSONB;
  v_parent UUID;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'only the platform admin may move a student between businesses';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = p_student_id;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  UPDATE student_class_enrolments
     SET is_active = FALSE, unenrolled_at = NOW()
   WHERE student_id = p_student_id AND is_active;

  -- level_id = NULL alongside the tenant change: tenant A's level ladder is
  -- meaningless at B, and leaving it set makes trg_student_level_tenant refuse
  -- the whole move (see header #1). B's admin re-levels the student.
  UPDATE students
     SET tenant_id = p_tenant_id,
         assignment_status = 'unassigned',
         level_id = NULL,
         updated_at = NOW()
   WHERE id = p_student_id;

  -- Give every linked parent a membership at B so the family can see the child
  -- they now own. Zero parents (an admin-created child) is a clean no-op.
  FOR v_parent IN
    SELECT parent_id FROM parent_students WHERE student_id = p_student_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM parent_tenants
       WHERE parent_id = v_parent AND tenant_id = p_tenant_id
    ) THEN
      -- Membership exists — reactivate it if a previous offboarding left it
      -- inactive, or the pickers and billing grouping (which filter is_active)
      -- would keep the family invisible at B. Does not fire the offboard guard.
      UPDATE parent_tenants
         SET is_active = TRUE, inactivated_at = NULL
       WHERE parent_id = v_parent
         AND tenant_id = p_tenant_id
         AND NOT is_active;
    ELSE
      -- ON CONFLICT DO NOTHING (never DO UPDATE) so two concurrent moves of
      -- siblings sharing a parent cannot race to a unique violation on
      -- (parent_id, tenant_id). §7.57 does not apply — nothing is UPDATEd on
      -- conflict, so there is no upsert-resolved update to govern.
      INSERT INTO parent_tenants (parent_id, tenant_id)
      VALUES (v_parent, p_tenant_id)
      ON CONFLICT (parent_id, tenant_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor, 'student_tenant_reassigned', 'Student', p_student_id, v_old,
          (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id),
          p_tenant_id);
END;
$function$

;

