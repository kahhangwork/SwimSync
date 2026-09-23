// The Forgot Password screen's auth call (docs/refactor/BATCH_FGH_PLAN.md, app
// fence). Byte-identical to the call it replaced.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const resetPasswordForEmail = (email: string, options: { redirectTo: string }) =>
  supabase.auth.resetPasswordForEmail(email, options);
