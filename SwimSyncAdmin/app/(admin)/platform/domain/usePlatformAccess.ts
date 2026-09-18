// The platform-admin gate. Stage 4 of docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// ⚠ THIS IS A UX AFFORDANCE, NOT THE SECURITY BOUNDARY. Every write on this page
// goes through an RPC that enforces platform-admin ITSELF (see dao/platform.rpc.ts).
// Moving the gate into a hook does not change that, and nothing here should grow
// into a second, weaker copy of a rule the database already owns.
//
// ⚠ NO useEffect LIVES IN HERE. `check()` returns the verdict so the PAGE's single
// mount effect can chain `load()` off the return value:
//
//     useEffect(() => { (async () => { if (await check()) await load(); })(); }, []);
//
// That is the playbook §5 "have load() RETURN the id" pattern. It is what lets
// this hook be created BEFORE useTenants with no creation dependency on it — a
// useEffect in here would need `load`, which would invert the two hooks' order.

import { useState } from "react";
import { currentUser, profileRole } from "../dao/platform.repo";

export function usePlatformAccess() {
  // null = still deciding. It is a THIRD state, not a falsy boolean: collapsing
  // it into `false` flashes the "this page is for the platform admin" refusal at
  // the platform admin themselves on every load.
  const [allowed, setAllowed] = useState<boolean | null>(null);

  async function check(): Promise<boolean> {
    const { data: auth } = await currentUser();
    if (!auth.user) {
      setAllowed(false);
      return false;
    }
    const { data: profile } = await profileRole(auth.user.id);

    const ok = profile?.role === "platform_admin";
    setAllowed(ok);
    return ok;
  }

  return { allowed, check };
}
