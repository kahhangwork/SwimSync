-- ============================================================
-- 20260819000100 — class capacity + colour, and the admin's audit row
--
-- Slice A of docs/plans/ADMIN_CALENDAR_PLAN.md. Three nullable columns and one
-- policy widening; no grant changes (every privilege touched is already held —
-- table_grants.test.sql proves the whitelist still matches).
--
--   class_categories.default_capacity  SMALLINT  NULL = unlimited
--   classes.capacity                   SMALLINT  NULL = use the category default
--   classes.colour                     TEXT      a PALETTE KEY ('sky', 'rose', …),
--                                                never a hex value. NULL = neutral.
--                                                The app maps unknown keys to grey,
--                                                so the CHECK only bounds the shape.
--
-- Capacity is informational for the admin calendar's "4+1/6" count. NOTHING
-- refuses a booking or an enrolment on it (book_makeup / book_trial / enrol are
-- untouched) — an over-capacity class is a thing the admin sees, not a thing
-- the database forbids. Making it a hard limit is a separate decision
-- (BACKLOG: parent self-enrolment).
--
-- None of these columns is effective-dated: set_class_terms is untouched and
-- the admin writes them with a plain UPDATE beside the RPC, exactly as
-- category_id is written today (classes/page.tsx).
--
-- ── audit_log_insert ───────────────────────────────────────────────────────
-- The admin panel is about to write attendance (lesson detail page, Slice C)
-- through the SAME path as the coach app: lesson_sessions insert → attendance
-- upsert → audit_log row. sessions_write (20260718000900) and attendance_write
-- (20260811000200) already admit can_admin_tenant; the window guards and the
-- credit-note trigger are role-agnostic. The ONE thing that refused a pure
-- tenant admin was audit_log_insert (20260804000300), which requires
-- coach_owns_session(entity_id) — a tenant admin with no coaches row has no
-- current_coach_id() and the row was refused with 42501. Widened by exactly one
-- disjunct. Scope stays: actor = caller, entity_type = 'lesson_session', and
-- the session must be in a business the caller administers.
--
-- ⚠ The INSERT grant on audit_log already exists (20260804000600:85); adding
-- the policy arm without a grant is therefore complete, and adding a grant
-- here would be a no-op. Do NOT widen further (e.g. any entity_type) — the
-- policy is the only thing stopping any signed-in user writing any audit row.
-- ============================================================

ALTER TABLE public.class_categories
  ADD COLUMN IF NOT EXISTS default_capacity SMALLINT
    CONSTRAINT class_categories_default_capacity_positive CHECK (default_capacity > 0);

COMMENT ON COLUMN public.class_categories.default_capacity IS
  'Default maximum number of students for a class in this category. NULL = unlimited. Overridden per class by classes.capacity. Informational (admin calendar "x/y" count); no RPC refuses on it.';

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS capacity SMALLINT
    CONSTRAINT classes_capacity_positive CHECK (capacity > 0),
  ADD COLUMN IF NOT EXISTS colour TEXT
    CONSTRAINT classes_colour_is_palette_key CHECK (colour ~ '^[a-z]{3,12}$');

COMMENT ON COLUMN public.classes.capacity IS
  'Maximum students for THIS class. NULL = use class_categories.default_capacity (NULL there = unlimited). Informational only — see 20260819000100.';
COMMENT ON COLUMN public.classes.colour IS
  'Admin calendar colour: a palette KEY (e.g. sky, rose, amber) defined in SwimSyncAdmin/lib/classColours.ts — never a hex value. NULL or an unknown key renders neutral grey.';

-- ── The admin may record that THEY saved attendance on a session of their business ──
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND entity_type = 'lesson_session'
    AND (
      coach_owns_session(entity_id)
      OR can_admin_tenant(session_tenant(entity_id))
    )
  );

COMMENT ON POLICY audit_log_insert ON public.audit_log IS
  'A coach may record saving attendance on a session they own; a tenant admin on a session of a business they administer (20260819000100 — the admin lesson page shares the coach save path). Everything else audits through SECURITY DEFINER functions.';
