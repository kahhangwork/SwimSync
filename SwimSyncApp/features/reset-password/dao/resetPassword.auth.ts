// The Reset Password screen's auth calls (docs/refactor/BATCH_FGH_PLAN.md, app
// fence). Each byte-identical to the call it replaced.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const getSession = () => supabase.auth.getSession();

export const updatePassword = (password: string) =>
  supabase.auth.updateUser({ password });

export const signOut = () => supabase.auth.signOut();
