// Admins page — Postgres function calls.

import { supabase } from "@/lib/supabase";

// Demotion, not deletion: owner-gated in the database and touches nothing at the
// auth layer, so it is called directly (an admin who is ALSO a coach loses only
// the admin role — their coach account, classes and history survive).
export function removeAdminRole(profileId: string) {
  return supabase.rpc("remove_admin_role", { p_profile_id: profileId });
}
