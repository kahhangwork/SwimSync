// The parent Profile tab's auth call (docs/refactor/BATCH_FGH_PLAN.md, app fence).
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const signOut = () => supabase.auth.signOut();
