// The Accept Invite screen's two PostgREST calls (docs/refactor/BATCH_FGH_PLAN.md,
// app fence). Raw builders, byte-identical to the chains they replaced.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchInvitedChildName = () =>
  supabase
    .from("students")
    .select("full_name")
    .limit(1);

export const updateInvitedProfile = (
  userId: string,
  fields: { full_name: string; phone: string | null }
) =>
  supabase
    .from("profiles")
    .update(fields)
    .eq("id", userId);
