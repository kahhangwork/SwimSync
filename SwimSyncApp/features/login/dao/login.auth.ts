// The Login screen's auth call (docs/refactor/BATCH_FGH_PLAN.md, app fence). The
// credentials object is built at the call site in domain/useLogin exactly as before.
//
// dao/ is transport only (fence check 2).
import type { SignInWithPasswordCredentials } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const signInWithPassword = (credentials: SignInWithPasswordCredentials) =>
  supabase.auth.signInWithPassword(credentials);
