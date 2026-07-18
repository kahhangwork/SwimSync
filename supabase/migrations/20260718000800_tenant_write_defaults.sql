-- ============================================================
-- Multi-tenancy: derive a class's tenant from its coach.
--
-- classes.tenant_id is denormalised (every RLS policy reads it) but it is NOT
-- independent data — a class belongs to whatever business its coach does. Made
-- a trigger rather than a frontend responsibility for two reasons: the admin
-- panel would otherwise have to pass it on every create AND edit, and a caller
-- that forgot would write a class into the wrong tenant, which is exactly the
-- kind of row the enrolment guard exists to prevent downstream.
--
-- Same pattern as the existing BEFORE INSERT trigger that fills a lesson
-- session's start/end times from its class (20260309000900).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fill_class_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id FROM coaches WHERE id = NEW.coach_id;

  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'class references coach % which has no tenant', NEW.coach_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER class_tenant_fill
  BEFORE INSERT OR UPDATE OF coach_id ON classes
  FOR EACH ROW EXECUTE FUNCTION public.fill_class_tenant();
