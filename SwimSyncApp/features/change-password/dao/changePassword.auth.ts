// The Change Password screen's auth call (docs/refactor/BATCH_FGH_PLAN.md, app
// fence). Byte-identical to the call it replaced.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const updatePassword = (password: string) =>
  supabase.auth.updateUser({ password });
