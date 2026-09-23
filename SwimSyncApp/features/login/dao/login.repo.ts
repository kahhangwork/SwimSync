// The Login screen's two post-sign-in reads (docs/refactor/BATCH_FGH_PLAN.md, app
// fence). Raw builders, byte-identical to the chains they replaced in
// app/(auth)/login.tsx.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchLoginProfile = (userId: string) =>
  supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", userId)
    .single();

export const fetchCoachRow = (userId: string) =>
  supabase
    .from("coaches")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();
