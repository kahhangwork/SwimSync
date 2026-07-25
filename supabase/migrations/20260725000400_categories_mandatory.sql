-- ============================================================
-- Every class belongs to a category (TRIAL_BOOKINGS_PLAN.md phase 1).
--
-- WHY. A category is about to decide what a TRIAL costs, so "the class has no
-- category" would mean "this trial has no price". Making it mandatory removes
-- that case entirely — and with it a whole scope-less-default tier that would
-- otherwise have existed only to paper over untagged classes.
--
-- Note what does NOT move: a class's own PRICE stays per-class and
-- effective-dated in `class_rates`. Production proves why — one business has
-- four classes in one category priced $40/$35/$35/$40. Category is "what kind
-- of class this is", not "what it costs".
--
-- NO TRIGGER AUTO-FILLS A MISSING CATEGORY, deliberately. It would silently
-- drop a class into Default Group when the admin meant Default Private, which
-- now decides its trial price. This is the same refusal-to-guess the auth
-- trigger makes about a coach's tenant (20260718000700): a wrong guess that
-- looks like success is worse than a loud failure. The cost is ~26 test
-- fixtures having to say which category they mean, which is the right trade.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Every tenant gets the two starting categories.
--
-- Skipped by NAME (case/whitespace-insensitively, matching
-- class_categories_name_uniq) so re-running is safe and so a tenant that
-- already made one of these keeps it.
-- ------------------------------------------------------------
INSERT INTO class_categories (tenant_id, name)
SELECT t.id, v.name
  FROM tenants t
  CROSS JOIN (VALUES ('Default Private'), ('Default Group')) AS v(name)
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories c
    WHERE c.tenant_id = t.id
      AND lower(trim(c.name)) = lower(trim(v.name))
 );

-- ------------------------------------------------------------
-- 2. Backfill every untagged class to its OWN tenant's Default Group.
--
-- Uniformly, including for a tenant that already had some other category. A
-- migration must not guess that an existing category was "meant" for these
-- classes, and it must not delete one it thinks is redundant — that is the
-- business's data, and tidying it up is their call, not this file's.
-- ------------------------------------------------------------
UPDATE classes c
   SET category_id = cc.id
  FROM class_categories cc
 WHERE c.category_id IS NULL
   AND cc.tenant_id = c.tenant_id
   AND lower(trim(cc.name)) = 'default group';

-- ------------------------------------------------------------
-- 3. Prove the backfill was total BEFORE tightening the column.
--
-- Without this, step 4 fails with a bare NOT NULL violation that names a
-- column nobody touched, halfway through a production deploy. A class can be
-- left behind if its tenant somehow has no Default Group — so both are
-- checked, and the message says which rows and how many.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_untagged INT;
  v_missing  INT;
BEGIN
  SELECT COUNT(*) INTO v_untagged FROM classes WHERE category_id IS NULL;
  IF v_untagged > 0 THEN
    RAISE EXCEPTION
      'backfill incomplete: % class(es) still have no category. Tenants missing a Default Group: %',
      v_untagged,
      (SELECT string_agg(DISTINCT c.tenant_id::text, ', ')
         FROM classes c WHERE c.category_id IS NULL);
  END IF;

  -- A tenant with zero classes is invisible to the check above but must still
  -- be able to create one afterwards.
  SELECT COUNT(*) INTO v_missing
    FROM tenants t
   WHERE NOT EXISTS (
     SELECT 1 FROM class_categories c
      WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group'
   );
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% tenant(s) have no Default Group category', v_missing;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Tighten.
-- ------------------------------------------------------------
ALTER TABLE classes ALTER COLUMN category_id SET NOT NULL;

-- ON DELETE SET NULL is now a contradiction: it would try to write NULL into a
-- NOT NULL column, so deleting a category with classes would fail with a
-- null-violation naming a column the admin never touched. RESTRICT says what is
-- actually wrong — "this category still has classes".
ALTER TABLE classes DROP CONSTRAINT classes_category_id_fkey;
ALTER TABLE classes
  ADD CONSTRAINT classes_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES class_categories(id) ON DELETE RESTRICT;

COMMENT ON COLUMN classes.category_id IS
  'What KIND of class this is (Group, Private…). Mandatory. Scopes packages and decides the TRIAL price — but NOT the lesson price, which is per-class and effective-dated in class_rates. Mutable, so anything pricing from it must SNAPSHOT it at the moment of sale (see trial_bookings.category_id).';
