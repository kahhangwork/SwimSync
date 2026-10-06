import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";

/** Server-only admin client (bypasses RLS). Never import in client components. */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
