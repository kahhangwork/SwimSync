-- What a swimming level actually MEANS: the skills taught at it.
--
-- A business's ladder was labels only ("Toddler 1", "Beginner 3"), which says
-- nothing about what a child is working towards. Real curricula are a LIST of
-- discrete named skills per rung — "Aeroplane Kick", "Torpedo Glide w/ board",
-- "Rules of the pool" — usually 3–6 of them, in a deliberate order.
--
-- A TABLE, NOT A TEXT BLOB, deliberately. A description field would render the
-- same to a reader today, but the skills are a list and storing them as prose
-- makes them opaque: nothing can count them, order them, or ever mark one as
-- passed. If per-child progress tracking is ever wanted, this is the shape it
-- needs — and converting prose into rows afterwards is a migration nobody
-- wants to write against real curricula.
--
-- NOT per-child, and that is a deliberate line. These describe the LEVEL, not
-- any student's progress against it. Ticking skills off per child is a real
-- feature (coach write access they do not currently have on students, a
-- marking UI, and a decision about what happens to those records when a child
-- changes level) and is filed in BACKLOG.md rather than half-built here.

CREATE TABLE tenant_level_skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id    UUID NOT NULL REFERENCES tenant_levels(id) ON DELETE CASCADE,
  label       TEXT NOT NULL CHECK (length(trim(label)) > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ON DELETE CASCADE, unlike students.level_id which is SET NULL: a skill has no
-- meaning without its level, whereas a student obviously survives one being
-- retired.

CREATE INDEX tenant_level_skills_level_sort_idx
  ON tenant_level_skills (level_id, sort_order, label);

-- No duplicate skills within one level. An EXPRESSION index — see the fix
-- below for why a plain one is not enough.
CREATE UNIQUE INDEX tenant_level_skills_label_uniq
  ON tenant_level_skills (level_id, lower(trim(label)));

-- ⚠️ CREATE TABLE LEAVES RLS OFF (§7.20). Audit after any new table:
--   SELECT relname FROM pg_class WHERE relkind='r'
--     AND relnamespace='public'::regnamespace AND NOT relrowsecurity;
ALTER TABLE tenant_level_skills ENABLE ROW LEVEL SECURITY;

-- Visible to anyone who can see the level it belongs to. Reached through
-- tenant_levels rather than repeating the tenant predicate, so the two can
-- never disagree about who may read a ladder.
--
-- A bare EXISTS across tables is what made classes_select and enrolments_select
-- mutually recursive (§6). Safe here because tenant_levels' own policy does not
-- reach back to this table — the reference is one-way and the graph stays
-- acyclic. Do not add a policy on tenant_levels that consults its skills.
CREATE POLICY tenant_level_skills_select ON tenant_level_skills
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM tenant_levels l WHERE l.id = level_id));

CREATE POLICY tenant_level_skills_write ON tenant_level_skills
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM tenant_levels l
     WHERE l.id = level_id AND can_admin_tenant(l.tenant_id)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tenant_levels l
     WHERE l.id = level_id AND can_admin_tenant(l.tenant_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_level_skills TO authenticated;
GRANT ALL ON tenant_level_skills TO service_role;

COMMENT ON TABLE tenant_level_skills IS
  'The skills taught at a level — reference material describing the LEVEL, not '
  'any child''s progress against it. Ordered by sort_order.';

-- ── A note on the level itself ─────────────────────────────────────────────
-- Real curricula carry lines that are not skills: "Progress to B3 upon
-- completing T4" is a progression rule, and jamming it in as a fake skill is
-- what an admin would otherwise be forced to do.
ALTER TABLE tenant_levels ADD COLUMN note TEXT;

COMMENT ON COLUMN tenant_levels.note IS
  'Free text about the level that is not a skill — typically a progression '
  'rule ("Progress to B3 upon completing T4").';

-- ── FIX: the level-name constraint did not do what its comment claimed ─────
-- 20260719001800 said the uniqueness was "trimmed + lowercased ... a constraint
-- that ' Level 1' defeats is not a constraint" — and then wrote a plain
-- UNIQUE (tenant_id, label). Verified against the deployed schema: 'Seahorse'
-- and '  seahorse  ' both inserted. The comment described the intent and the
-- code shipped the thing the comment warned about.
--
-- Safe to tighten: the levels feature deployed the same day and the guard below
-- refuses rather than silently dropping a row if any business has already
-- created names that collide under the stricter rule.
DO $$
DECLARE v_dupes INTEGER;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT tenant_id, lower(trim(label))
      FROM tenant_levels
     GROUP BY 1, 2
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Refusing to tighten the level-name constraint: % business(es) have level names that differ only by case or whitespace. Rename them first.', v_dupes;
  END IF;
END $$;

ALTER TABLE tenant_levels DROP CONSTRAINT tenant_levels_tenant_id_label_key;

CREATE UNIQUE INDEX tenant_levels_label_uniq
  ON tenant_levels (tenant_id, lower(trim(label)));
