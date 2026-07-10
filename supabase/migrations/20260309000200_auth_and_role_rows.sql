-- ============================================================
-- Auth trigger: on new auth.users row, create the profile AND
-- the matching role-specific row (parents / coaches).
--
-- FIX: the original trigger only created a `profiles` row, so no
-- `parents` row ever existed. The parent app immediately queries
-- `parents` by profile_id (home screen, add-child) and failed with
-- "Could not find your parent account". This creates that row up
-- front so onboarding works end to end.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role user_role;
BEGIN
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'parent');

  INSERT INTO profiles (id, email, role, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );

  IF v_role = 'parent' THEN
    INSERT INTO parents (profile_id) VALUES (NEW.id);
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id) VALUES (NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
