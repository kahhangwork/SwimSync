-- Where a family lives.
--
-- The coach has no way to reach a family off-platform beyond a phone number,
-- and the postal code answers the one question behind every enquiry: "is this
-- family near a pool I teach at?"
--
-- ON parents, NOT profiles: profiles is shared with coaches and admins, and a
-- home address is a parent-shaped fact. Email and phone are already collected
-- at signup and live on profiles, so this is address + postal code only.
--
-- postal_code IS TEXT, NEVER AN INTEGER. Singapore postal codes have leading
-- zeros ("018956"), which an integer silently eats — and this codebase has been
-- bitten twice by numeric coercion already: Number(null) turned an unset
-- invoice run day into day 1 (§7.14), and Number("") saved a $0 wage rate
-- (§7.22). Stored as 6 digits; the address itself stays free text, because
-- Singapore addresses do not decompose usefully.
--
-- Both NULLABLE: every existing parent predates this, and a registration form
-- that suddenly refuses to submit without an address would block the very
-- onboarding push this is meant to help.

ALTER TABLE parents ADD COLUMN address     TEXT;
ALTER TABLE parents ADD COLUMN postal_code TEXT
  CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{6}$');

COMMENT ON COLUMN parents.postal_code IS
  'Singapore 6-digit postal code. TEXT, never an integer — leading zeros are '
  'significant ("018956").';

-- ── A parent may maintain their own record ─────────────────────────────────
-- parents_update was is_platform_admin() only, so a parent could not write
-- their own row at all. That was fine while the table held nothing they owned;
-- an address is theirs to correct.
--
-- Safe to open BECAUSE the table now holds no money: parents.credit_balance
-- was dropped in 20260719000300 when balances moved to parent_tenant_balances
-- (credit never crosses businesses). Had that column still been here, this
-- policy would have let a family set their own credit balance. If a
-- money-shaped column is ever added to `parents`, this policy is the thing to
-- revisit first.
CREATE POLICY parents_update_self ON parents
  FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- profile_id IS the row's access rule, so a client that could rewrite it could
-- reassign the record to someone else — the same shape as students.created_by
-- (20260719001500). A WITH CHECK cannot express this on its own: it cannot see
-- the OLD row, so it cannot say "this column did not change".
CREATE OR REPLACE FUNCTION pin_parent_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'parents.profile_id is not client-writable — it is the row''s own access rule.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pin_parent_identity
  BEFORE UPDATE ON parents
  FOR EACH ROW
  EXECUTE FUNCTION pin_parent_identity();
