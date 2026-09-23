// Every PostgREST read and write the coach Settings tab makes
// (docs/refactor/BATCH_FGH_PLAN.md, App L-H). Raw builders, byte-identical to the
// chains they replaced in app/(coach)/settings/index.tsx.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

type Session = { id: string };

export const fetchCoach = (session: Session) =>
  supabase
    .from("coaches")
    .select("id, tenant_id")
    .eq("profile_id", session.id)
    .single();

export const fetchTenantPaynow = (tenantId: string) =>
  supabase
    .from("tenants")
    .select("paynow_qr_url, paynow_uen, paynow_mobile")
    .eq("id", tenantId)
    .maybeSingle();

export const fetchProfileRole = (session: Session) =>
  supabase
    .from("profiles")
    .select("role")
    .eq("id", session.id)
    .maybeSingle();

export const updateTenantQrUrl = (tenantId: string, publicUrl: string) =>
  supabase
    .from("tenants")
    .update({ paynow_qr_url: publicUrl })
    .eq("id", tenantId);
