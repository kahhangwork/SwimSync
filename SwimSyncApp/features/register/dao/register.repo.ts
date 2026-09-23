// The Register screen's two post-signup writes (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). Raw builders, byte-identical to the chains they replaced in
// app/(auth)/register.tsx; both stay best-effort at the call site (plan ⚠ R10).
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

// Update phone in profiles
export const updateProfilePhone = (userId: string, phone: string) =>
  supabase
    .from("profiles")
    .update({ phone })
    .eq("id", userId);

export const updateParentAddress = (
  userId: string,
  fields: { address: string | null; postal_code: string | null }
) =>
  supabase
    .from("parents")
    .update(fields)
    .eq("profile_id", userId);
