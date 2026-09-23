// The Register screen's auth call (docs/refactor/BATCH_FGH_PLAN.md, App L-H). The
// credentials object — the join code carried in user_metadata included — is built
// at the call site in domain/useRegister exactly as before; this only sends it.
//
// dao/ is transport only (fence check 2).
import type { SignUpWithPasswordCredentials } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const signUp = (credentials: SignUpWithPasswordCredentials) =>
  supabase.auth.signUp(credentials);
