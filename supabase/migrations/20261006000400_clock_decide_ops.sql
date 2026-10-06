-- Wave 7, M2: the non-billing DECIDE functions that read now() directly now read app_now().
-- docs/plans/WAVE7_DB_CLOCK_PLAN.md — Appendix A, rows M2 (9 functions).
--
-- WHAT. Package coverage / start suggestion / renewal candidates, the platform overview's month boundaries, the
-- unmarked-lesson count's time of day, and the referral-reward expiry family. Each body is pg_get_functiondef of
-- the live body with ONLY its decision clock tokens changed (now() → app_now()); in settle_referral_reward the
-- used_at / converted_at stamps stay now() (STAMP — nothing reads them back for a date). Signature, volatility,
-- SECURITY mode, search_path and ACL are untouched (§7.336). Prod returns exactly what it did: app_now() = now()
-- there. The four SECURITY INVOKER ones (student_package_coverage, suggest_package_start,
-- package_renewal_candidates, family_has_usable_reward) are executable by authenticated + service_role, both of
-- which hold app_now() since M1.
--
-- ROLLBACK: supabase/rollback/20261006000400_clock_decide_ops_DOWN.sql (byte-identical pre-M2 bodies). Run it
-- BEFORE M1's DOWN.

CREATE OR REPLACE FUNCTION public.student_package_coverage()
 RETURNS TABLE(student_id uuid, parent_id uuid, tenant_id uuid, coverage text, lessons_remaining integer, package_id uuid, package_name text, expires_on date, low boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH live AS (
  SELECT lv.parent_package_id, lv.parent_id, lv.tenant_id, lv.category_id,
         lv.live_lessons_remaining, lv.expires_on, lv.name
  FROM package_live_balances() lv
  JOIN parent_packages pp ON pp.id = lv.parent_package_id
  WHERE lv.expires_on >= (app_now() AT TIME ZONE 'Asia/Singapore')::date
    AND pp.start_date <= (app_now() AT TIME ZONE 'Asia/Singapore')::date
),
links AS (
  SELECT ps.student_id, ps.parent_id, s.tenant_id
  FROM parent_students ps
  JOIN students s ON s.id = ps.student_id
),
cats AS (
  SELECT DISTINCT sce.student_id, c.category_id
  FROM student_class_enrolments sce
  JOIN classes c ON c.id = sce.class_id
  WHERE sce.is_active
),
-- ⚠ RISK 2 — "low" is a FAMILY verdict, and a family that already has an open
-- pending row or a future-start active package is NOT low (those are not in
-- `live`, so without this exclusion they would flag as low forever).
fam AS (
  SELECT l.parent_id, l.tenant_id,
         sum(l.live_lessons_remaining)::integer AS fam_left,
         max(l.expires_on)                      AS fam_max_expiry
  FROM live l
  GROUP BY l.parent_id, l.tenant_id
),
open_row AS (
  SELECT DISTINCT pp.parent_id, pp.tenant_id
  FROM parent_packages pp
  WHERE pp.status = 'pending'
     OR (pp.status = 'active'
         AND pp.start_date > (app_now() AT TIME ZONE 'Asia/Singapore')::date)
),
fam_low AS (
  SELECT f.parent_id, f.tenant_id,
    ( (f.fam_left <= t.low_package_lessons
       OR f.fam_max_expiry - (app_now() AT TIME ZONE 'Asia/Singapore')::date
            <= t.package_expiry_warning_days)
      AND NOT EXISTS (SELECT 1 FROM open_row o
                       WHERE o.parent_id = f.parent_id AND o.tenant_id = f.tenant_id)
    ) AS low
  FROM fam f
  JOIN tenants t ON t.id = f.tenant_id
),
verdict AS (
  SELECT
    l.student_id, l.parent_id, l.tenant_id,
    (SELECT count(*) FROM cats ct WHERE ct.student_id = l.student_id) AS n_cats,
    (SELECT count(*) FROM cats ct
      WHERE ct.student_id = l.student_id
        AND EXISTS (
          SELECT 1 FROM live lv
          WHERE lv.parent_id = l.parent_id
            AND lv.tenant_id = l.tenant_id
            AND (lv.category_id IS NULL OR lv.category_id = ct.category_id)
        )) AS n_covered,
    EXISTS (
      SELECT 1 FROM live lv
      WHERE lv.parent_id = l.parent_id AND lv.tenant_id = l.tenant_id
    ) AS has_any
  FROM links l
),
-- The covering package to SHOW per student: earliest-expiring covering package
-- that still has live lessons (fallback: earliest covering). Covering = the
-- package is all-classes, or its category is one of the student's.
cover AS (
  SELECT v.student_id,
    (SELECT lv.parent_package_id FROM live lv
      WHERE lv.parent_id = v.parent_id AND lv.tenant_id = v.tenant_id
        AND (lv.category_id IS NULL
             OR lv.category_id IN (SELECT ct.category_id FROM cats ct
                                    WHERE ct.student_id = v.student_id))
      ORDER BY (lv.live_lessons_remaining > 0) DESC, lv.expires_on, lv.parent_package_id
      LIMIT 1) AS package_id
  FROM verdict v
)
SELECT
  v.student_id,
  v.parent_id,
  v.tenant_id,
  CASE
    WHEN v.n_cats = 0 THEN CASE WHEN v.has_any THEN 'package' ELSE 'ad_hoc' END
    WHEN v.n_covered = 0 THEN 'ad_hoc'
    WHEN v.n_covered = v.n_cats THEN 'package'
    ELSE 'mixed'
  END AS coverage,
  CASE
    WHEN (v.n_cats = 0 AND v.has_any) OR v.n_covered > 0 THEN
      (SELECT sum(lv.live_lessons_remaining)::integer
       FROM live lv
       WHERE lv.parent_id = v.parent_id
         AND lv.tenant_id = v.tenant_id
         AND (v.n_cats = 0
              OR lv.category_id IS NULL
              OR lv.category_id IN (SELECT ct.category_id FROM cats ct
                                     WHERE ct.student_id = v.student_id)))
    ELSE NULL
  END AS lessons_remaining,
  cv.package_id,
  (SELECT lv.name       FROM live lv WHERE lv.parent_package_id = cv.package_id) AS package_name,
  (SELECT lv.expires_on FROM live lv WHERE lv.parent_package_id = cv.package_id) AS expires_on,
  CASE WHEN ((v.n_cats = 0 AND v.has_any) OR v.n_covered > 0)
       THEN COALESCE(fl.low, false) ELSE false END AS low
FROM verdict v
LEFT JOIN cover cv    ON cv.student_id = v.student_id
LEFT JOIN fam_low fl  ON fl.parent_id = v.parent_id AND fl.tenant_id = v.tenant_id
$function$

;

CREATE OR REPLACE FUNCTION public.suggest_package_start(p_parent_id uuid, p_product_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH today AS (
    SELECT (app_now() AT TIME ZONE 'Asia/Singapore')::date AS d
  ),
  prod AS (
    SELECT tenant_id, category_id FROM package_products WHERE id = p_product_id
  ),
  -- The parent's active packages that would OVERLAP the new one's coverage
  -- (same category, or either side is all-classes).
  active_pkgs AS (
    SELECT pp.id, pp.category_id, pp.expires_on, pp.rate_per_lesson, pp.value_remaining
    FROM parent_packages pp
    JOIN prod ON pp.tenant_id = prod.tenant_id
    WHERE pp.parent_id = p_parent_id
      AND pp.status = 'active'
      AND (prod.category_id IS NULL
           OR pp.category_id IS NULL
           OR pp.category_id = prod.category_id)
  ),
  -- Weekly draw rate PER package: how many of the covered kids' current
  -- active class enrolments this package would fund (one class = one lesson/wk;
  -- two kids, or a kid in two classes, both raise the rate — §8.43).
  weekly AS (
    SELECT ap.id,
           count(*) AS weekly_lessons
    FROM active_pkgs ap
    JOIN parent_students ps        ON ps.parent_id = p_parent_id
    JOIN student_class_enrolments e ON e.student_id = ps.student_id AND e.is_active
    JOIN classes c                  ON c.id = e.class_id
                                    AND c.is_active
                                    AND c.tenant_id = (SELECT tenant_id FROM prod)
                                    AND (ap.category_id IS NULL OR c.category_id = ap.category_id)
    GROUP BY ap.id
  ),
  done_dates AS (
    SELECT
      CASE
        WHEN COALESCE(w.weekly_lessons, 0) > 0 THEN
          LEAST(
            ap.expires_on,
            (SELECT d FROM today)
              + (ceil(floor(ap.value_remaining / ap.rate_per_lesson)::numeric
                      / w.weekly_lessons)::int * 7)
          )
        ELSE ap.expires_on
      END AS done_date
    FROM active_pkgs ap
    LEFT JOIN weekly w ON w.id = ap.id
  )
  SELECT COALESCE(
    (SELECT max(done_date) + 1 FROM done_dates),
    (SELECT d FROM today)
  );
$function$

;

CREATE OR REPLACE FUNCTION public.package_renewal_candidates()
 RETURNS TABLE(parent_id uuid, tenant_id uuid, parent_name text, parent_phone text, children text, package_name text, lessons_left integer, expires_on date, expired_days_ago integer, original_product_id uuid, suggested_product_id uuid, has_open_offer boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH today AS (SELECT (app_now() AT TIME ZONE 'Asia/Singapore')::date AS d),
cov AS MATERIALIZED (
  SELECT * FROM student_package_coverage()
),
low_fams AS (
  SELECT DISTINCT c.parent_id, c.tenant_id FROM cov c WHERE c.low
),
expired_fams AS (
  SELECT pp.parent_id, pp.tenant_id,
         (SELECT d FROM today) - max(pp.expires_on) AS expired_days_ago
  FROM parent_packages pp
  WHERE pp.status = 'active'
    AND pp.expires_on <  (SELECT d FROM today)
    AND pp.expires_on >= (SELECT d FROM today) - 30
    AND NOT EXISTS (
      SELECT 1 FROM parent_packages o
      WHERE o.parent_id = pp.parent_id AND o.tenant_id = pp.tenant_id
        AND (o.status = 'pending'
             OR (o.status = 'active' AND o.expires_on >= (SELECT d FROM today)))
    )
  GROUP BY pp.parent_id, pp.tenant_id
),
fams AS (
  SELECT parent_id, tenant_id, NULL::integer AS expired_days_ago FROM low_fams
  UNION
  SELECT parent_id, tenant_id, expired_days_ago FROM expired_fams
        WHERE (parent_id, tenant_id) NOT IN (SELECT parent_id, tenant_id FROM low_fams)
),
-- Most recent non-cancelled package the family bought — its product AND category.
original AS (
  SELECT DISTINCT ON (pp.parent_id, pp.tenant_id)
         pp.parent_id, pp.tenant_id, pp.product_id, pp.category_id
  FROM parent_packages pp
  WHERE pp.status <> 'cancelled'
  ORDER BY pp.parent_id, pp.tenant_id, pp.requested_at DESC
)
SELECT
  f.parent_id,
  f.tenant_id,
  pr.full_name AS parent_name,
  pr.phone     AS parent_phone,
  (SELECT string_agg(s.full_name, ', ' ORDER BY s.full_name)
     FROM parent_students ps JOIN students s ON s.id = ps.student_id
    WHERE ps.parent_id = f.parent_id AND s.is_active) AS children,
  (SELECT c.package_name FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id
      AND c.package_id IS NOT NULL
    ORDER BY c.expires_on NULLS LAST LIMIT 1) AS package_name,
  (SELECT max(c.lessons_remaining) FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id) AS lessons_left,
  (SELECT min(c.expires_on) FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id
      AND c.package_id IS NOT NULL) AS expires_on,
  f.expired_days_ago,
  o.product_id AS original_product_id,
  COALESCE(
    CASE WHEN op.is_active THEN o.product_id END,   -- the active original
    cat.default_product_id,                          -- the original's category default
    t.default_package_product_id                     -- the all-classes default
  ) AS suggested_product_id,
  EXISTS (SELECT 1 FROM parent_packages x
           WHERE x.parent_id = f.parent_id AND x.tenant_id = f.tenant_id
             AND x.status = 'pending' AND x.offered_by IS NOT NULL
             AND x.paid_claimed_at IS NULL AND x.superseded_by IS NULL) AS has_open_offer
FROM fams f
JOIN parents pa   ON pa.id = f.parent_id
JOIN profiles pr  ON pr.id = pa.profile_id
JOIN tenants t    ON t.id = f.tenant_id
LEFT JOIN original o           ON o.parent_id = f.parent_id AND o.tenant_id = f.tenant_id
LEFT JOIN package_products op  ON op.id = o.product_id
LEFT JOIN class_categories cat ON cat.id = o.category_id
$function$

;

CREATE OR REPLACE FUNCTION public.platform_tenant_overview()
 RETURNS TABLE(tenant_id uuid, display_name text, shape text, join_code text, active_students integer, active_classes integer, coaches integer, staff_without_rate integer, last_attendance_date date, sessions_this_month integer, sessions_fully_marked integer, last_month_billing text, active_families integer, admin_email text, admin_status text, suspended_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT is_platform_admin() AS ok),
  bounds AS (
    SELECT
      to_char((date_trunc('month', (app_now() AT TIME ZONE 'Asia/Singapore')) - INTERVAL '1 month'), 'YYYY-MM') AS last_month,
      date_trunc('month', (app_now() AT TIME ZONE 'Asia/Singapore'))::date AS this_month_start,
      (date_trunc('month', (app_now() AT TIME ZONE 'Asia/Singapore')) + INTERVAL '1 month')::date AS next_month_start
  )
  SELECT
    t.id,
    t.display_name,
    CASE
      WHEN (SELECT COUNT(*) FROM coaches co WHERE co.tenant_id = t.id) = 1
       AND EXISTS (
             SELECT 1 FROM coaches co
             JOIN profiles pr ON pr.id = co.profile_id
             WHERE co.tenant_id = t.id
               AND pr.role = 'tenant_admin' AND pr.tenant_id = t.id)
        THEN 'private coach'
      ELSE 'school'
    END,
    t.join_code,
    (SELECT COUNT(*)::INT FROM students s
       WHERE s.tenant_id = t.id AND s.is_active),
    (SELECT COUNT(*)::INT FROM classes c
       WHERE c.tenant_id = t.id AND c.is_active),
    (SELECT COUNT(*)::INT FROM coaches co
       WHERE co.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM coaches co
       JOIN profiles pr ON pr.id = co.profile_id
       WHERE co.tenant_id = t.id
         AND NOT (pr.role = 'tenant_admin' AND pr.tenant_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = co.id)),
    (SELECT MAX(ls.session_date) FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)
         AND (SELECT COUNT(*) FROM attendance a WHERE a.lesson_session_id = ls.id)
             >= (SELECT COUNT(*) FROM student_class_enrolments e
                   WHERE e.class_id = ls.class_id AND e.is_active)
         AND (SELECT COUNT(*) FROM student_class_enrolments e
                WHERE e.class_id = ls.class_id AND e.is_active) > 0),
    CASE
      WHEN EXISTS (SELECT 1 FROM billing_periods bp
                     WHERE bp.tenant_id = t.id
                       AND bp.billing_month = (SELECT last_month FROM bounds))
        THEN 'sealed'
      WHEN EXISTS (SELECT 1 FROM invoices i
                     WHERE i.tenant_id = t.id
                       AND i.billing_month = (SELECT last_month FROM bounds))
        THEN 'open'
      ELSE 'never run'
    END,
    (SELECT COUNT(*)::INT FROM parent_tenants pt
       WHERE pt.tenant_id = t.id AND pt.is_active),
    (SELECT pr.email FROM profiles pr WHERE pr.id = t.owner_profile_id),
    COALESCE((
      SELECT CASE WHEN u.last_sign_in_at IS NULL THEN 'invited' ELSE 'active' END
      FROM profiles pr
      JOIN auth.users u ON u.id = pr.id
      WHERE pr.id = t.owner_profile_id
    ), 'none'),
    t.suspended_at
  FROM tenants t, me
  WHERE me.ok                      -- THE GATE. No rows for anyone else.
  ORDER BY t.display_name;
$function$

;

CREATE OR REPLACE FUNCTION public.tenant_unmarked_lesson_count(p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT (is_platform_admin() OR (is_platform_admin() OR has_admin_area(p_tenant, 'operations', 'view'))) THEN
    RAISE EXCEPTION 'Not authorized to read the unmarked-lesson count for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH win AS (
    SELECT markable_floor(p_tenant)                    AS floor_date,
           today_sg()                                  AS today_date,
           (app_now() AT TIME ZONE 'Asia/Singapore')::time AS now_time
  ),
  cls AS (
    SELECT c.id, c.day_of_week, c.end_time,
           CASE WHEN c.deactivated_at IS NOT NULL
                THEN (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date
           END AS cutoff,
           (CASE c.day_of_week
              WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
              WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
              WHEN 'saturday' THEN 6 END) AS dow
      FROM classes c
     WHERE c.tenant_id = p_tenant
  ),
  -- Weekday series with a 7-day step from the first matching weekday >= floor.
  pattern AS (
    SELECT cl.id AS class_id, d::date AS session_date
      FROM cls cl, win w,
           generate_series(
             w.floor_date + (((cl.dow - EXTRACT(DOW FROM w.floor_date)::int) + 7) % 7) * INTERVAL '1 day',
             w.today_date,
             INTERVAL '7 days'
           ) AS d
  ),
  sess AS (
    SELECT ls.class_id, ls.session_date
      FROM lesson_sessions ls
      JOIN cls cl ON cl.id = ls.class_id
      CROSS JOIN win w
     WHERE ls.session_date BETWEEN w.floor_date AND w.today_date
  ),
  -- A pattern date on/after the retirement cutoff is dropped unless a session
  -- row exists for it; a session-row date is always kept.
  candidate AS (
    SELECT p.class_id, p.session_date
      FROM pattern p
      JOIN cls cl ON cl.id = p.class_id
     WHERE cl.cutoff IS NULL
        OR p.session_date < cl.cutoff
        OR EXISTS (SELECT 1 FROM sess s WHERE s.class_id = p.class_id AND s.session_date = p.session_date)
    UNION
    SELECT s.class_id, s.session_date FROM sess s
  ),
  expected AS (
    SELECT cd.class_id, cd.session_date, e.student_id
      FROM candidate cd
      JOIN student_class_enrolments e
        ON e.class_id = cd.class_id
       AND (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date <= cd.session_date
       AND (e.unenrolled_at IS NULL
            OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= cd.session_date)
     -- A cancelled lesson expects nobody enrolled (20260821000700).
     WHERE NOT EXISTS (
       SELECT 1 FROM lesson_sessions ls
        WHERE ls.class_id = cd.class_id
          AND ls.session_date = cd.session_date
          AND ls.cancelled_at IS NOT NULL
     )
    UNION
    SELECT cd.class_id, cd.session_date, tb.student_id
      FROM candidate cd
      JOIN trial_bookings tb ON tb.class_id = cd.class_id AND tb.session_date = cd.session_date AND tb.cancelled_at IS NULL
    UNION
    SELECT cd.class_id, cd.session_date, mb.student_id
      FROM candidate cd
      JOIN makeup_bookings mb ON mb.class_id = cd.class_id AND mb.session_date = cd.session_date AND mb.cancelled_at IS NULL
  ),
  agg AS (
    SELECT x.class_id, x.session_date,
           count(*) AS expected_ct,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM lesson_sessions ls
              JOIN attendance a ON a.lesson_session_id = ls.id AND a.student_id = x.student_id
             WHERE ls.class_id = x.class_id AND ls.session_date = x.session_date
           )) AS marked_ct
      FROM expected x
     GROUP BY x.class_id, x.session_date
  )
  SELECT count(*)::int INTO v_count
    FROM agg a
    JOIN cls cl ON cl.id = a.class_id
    CROSS JOIN win w
   WHERE a.expected_ct > 0
     AND a.marked_ct < a.expected_ct
     AND (
       a.marked_ct > 0
       OR a.session_date < w.today_date
       OR (a.session_date = w.today_date AND cl.end_time <= w.now_time)
     );

  RETURN v_count;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.apply_referral_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reward_id uuid;
  v_type  text;
  v_value numeric;
  v_disc  numeric;
BEGIN
  -- Pick the oldest usable reward for THIS family. The candidate set is:
  --   available + unexpired, OR reserved by an open unclaimed offer of the same
  -- family that this insert is about to supersede (RISK 4 — the offer still
  -- holds the reward while this row is priced; create_package_offer refuses on
  -- an open offer so it cannot release it, so the handoff resolves HERE).
  SELECT rr.id INTO v_reward_id
  FROM referral_rewards rr
  WHERE rr.parent_id = NEW.parent_id
    AND rr.tenant_id = NEW.tenant_id
    AND (rr.expires_at IS NULL OR rr.expires_at > app_now())
    AND (
      rr.status = 'available'
      OR (
        rr.status = 'reserved'
        AND NEW.status IN ('pending', 'active')
        AND EXISTS (
          SELECT 1 FROM parent_packages pp
          WHERE pp.id = rr.reserved_package_id
            AND pp.id <> NEW.id
            AND pp.status = 'pending'
            AND pp.offered_by IS NOT NULL
            AND pp.paid_claimed_at IS NULL
        )
      )
    )
  ORDER BY rr.earned_at, rr.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_reward_id IS NULL THEN
    RETURN NEW;  -- no reward; base price stands.
  END IF;

  SELECT dt.discount_type, dt.discount_value INTO v_type, v_value
    FROM referral_discount_for(NEW.product_id) dt;
  v_disc := referral_discount_amount(v_type, v_value, NEW.total_value);

  -- ⚠ D9 / D15 — a 0-discount product (or programme off) does NOT consume a
  -- reward; it waits for the next eligible package.
  IF v_disc <= 0 THEN
    RETURN NEW;
  END IF;

  NEW.discount_amount    := v_disc;
  NEW.amount_payable     := NEW.total_value - v_disc;
  NEW.referral_reward_id := v_reward_id;

  UPDATE referral_rewards
     SET status = 'reserved', reserved_package_id = NEW.id
   WHERE id = v_reward_id;

  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.family_has_usable_reward(p_parent_id uuid, p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM referral_rewards rr
    WHERE rr.parent_id = p_parent_id AND rr.tenant_id = p_tenant_id
      AND rr.status = 'available'
      AND (rr.expires_at IS NULL OR rr.expires_at > app_now())
    UNION ALL
    SELECT 1 FROM referral_rewards rr
    JOIN parent_packages pp ON pp.id = rr.reserved_package_id
    WHERE rr.parent_id = p_parent_id AND rr.tenant_id = p_tenant_id
      AND rr.status = 'reserved'
      AND (rr.expires_at IS NULL OR rr.expires_at > app_now())
      AND pp.status = 'pending' AND pp.offered_by IS NOT NULL
      AND pp.paid_claimed_at IS NULL
  );
$function$

;

CREATE OR REPLACE FUNCTION public.grant_referral_reward(p_parent_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_expiry   timestamptz;
  v_reward_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF v_tenant IS NULL OR NOT (is_platform_admin() OR has_admin_area(v_tenant, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to grant a referral reward.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM parent_tenants WHERE parent_id = p_parent_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'That family is not in this business.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT CASE WHEN t.referral_reward_expiry_days IS NULL THEN NULL
              ELSE app_now() + (t.referral_reward_expiry_days || ' days')::interval END
    INTO v_expiry FROM tenants t WHERE t.id = v_tenant;

  INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, expires_at,
                                granted_by, grant_reason)
  VALUES (v_tenant, p_parent_id, 'manual', NULL, v_expiry, auth.uid(), p_reason)
  RETURNING id INTO v_reward_id;
  RETURN v_reward_id;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.settle_referral_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_became_active boolean;
  v_reward        referral_rewards%ROWTYPE;
  v_ref           referrals%ROWTYPE;
  v_same_house    boolean;
  v_expiry        timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_became_active := (NEW.status = 'active');
  ELSE
    v_became_active := (NEW.status = 'active' AND OLD.status <> 'active');
  END IF;

  -- (a) Reserved reward settles when its package goes active. ⚠ RISK 13 — a
  -- reward that EXPIRED while reserved settles as 'expired' and the discount is
  -- zeroed ONLY on an unclaimed row; a claimed row keeps the price it was paid
  -- (§7.159 family — never re-price a paid_claimed_at row).
  IF NEW.referral_reward_id IS NOT NULL AND v_became_active THEN
    SELECT * INTO v_reward FROM referral_rewards
      WHERE id = NEW.referral_reward_id FOR UPDATE;
    IF v_reward.status = 'reserved' THEN
      IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at <= app_now()
         AND NEW.paid_claimed_at IS NULL THEN
        UPDATE referral_rewards SET status = 'expired' WHERE id = v_reward.id;
        UPDATE parent_packages
           SET discount_amount = 0, amount_payable = total_value, referral_reward_id = NULL
         WHERE id = NEW.id;
      ELSE
        UPDATE referral_rewards
           SET status = 'used', used_package_id = NEW.id, used_at = now()
         WHERE id = v_reward.id;
      END IF;
    END IF;
  END IF;

  -- (b) A pending row that is cancelled (parent cancel, or supersede) releases
  -- its reserved reward back to available (or expired). The reserved_package_id
  -- guard is the RISK 4 safety: if apply_referral_reward re-pointed the reward
  -- to a newer row, this WHERE does not match and the reward is NOT released.
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'cancelled'
     AND NEW.referral_reward_id IS NOT NULL THEN
    UPDATE referral_rewards
       SET status = CASE WHEN expires_at IS NOT NULL AND expires_at <= app_now()
                         THEN 'expired' ELSE 'available' END,
           reserved_package_id = NULL
     WHERE id = NEW.referral_reward_id
       AND status = 'reserved'
       AND reserved_package_id = NEW.id;
  END IF;

  -- (c) Conversion — the referee's first package goes active. Once per referral
  -- (the pending→converted transition is the idempotency guard). ⚠ RISK 1 — a
  -- shared student / phone / postal_code voids it as same_household with no
  -- reward; the admin's manual Grant is the override.
  IF v_became_active THEN
    SELECT * INTO v_ref FROM referrals
      WHERE referee_parent_id = NEW.parent_id
        AND tenant_id = NEW.tenant_id
        AND status = 'pending'
      FOR UPDATE;
    IF FOUND THEN
      v_same_house := (
        EXISTS (
          SELECT 1 FROM parent_students a
          JOIN parent_students b ON a.student_id = b.student_id
          WHERE a.parent_id = v_ref.referrer_parent_id
            AND b.parent_id = v_ref.referee_parent_id
        )
        OR EXISTS (
          SELECT 1
          FROM parents pa1 JOIN profiles pr1 ON pr1.id = pa1.profile_id
          JOIN parents pa2 ON pa2.id = v_ref.referee_parent_id
          JOIN profiles pr2 ON pr2.id = pa2.profile_id
          WHERE pa1.id = v_ref.referrer_parent_id
            AND pr1.phone IS NOT NULL AND pr1.phone = pr2.phone
        )
        OR EXISTS (
          SELECT 1 FROM parents pa1 JOIN parents pa2 ON pa2.id = v_ref.referee_parent_id
          WHERE pa1.id = v_ref.referrer_parent_id
            AND pa1.postal_code IS NOT NULL AND pa1.postal_code = pa2.postal_code
        )
      );

      IF v_same_house THEN
        UPDATE referrals
           SET status = 'void', void_reason = 'same_household'
         WHERE id = v_ref.id;
      ELSE
        UPDATE referrals
           SET status = 'converted', converted_package_id = NEW.id, converted_at = now()
         WHERE id = v_ref.id;

        SELECT CASE WHEN t.referral_reward_expiry_days IS NULL THEN NULL
                    ELSE app_now() + (t.referral_reward_expiry_days || ' days')::interval END
          INTO v_expiry
          FROM tenants t WHERE t.id = NEW.tenant_id;

        INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, expires_at)
        VALUES (NEW.tenant_id, v_ref.referrer_parent_id, 'referrer', v_ref.id, v_expiry);
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$

;

