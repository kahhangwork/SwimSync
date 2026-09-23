// The one Edge Function the parent Billing tab calls (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). Returns the raw promise — the caller keeps it fire-and-forget: NOT
// awaited, `.catch(() => {})` at the call site (plan ⚠ R8).
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const invokePackageEmail = (packageId: string) =>
  supabase.functions
    .invoke("package-emails", {
      body: { type: "requested", package_id: packageId },
    });
