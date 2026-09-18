// The page-level notice banner. Stage 4 of docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// ⚠ THIS HOOK EXISTS TO BREAK A CYCLE, and that is its whole job. `message` is
// written by FOUR slices — resendInvite (provisioning), reassignOwner (owner
// transfer), toggleSuspend (suspend) and doMove/handleSearch (student move) —
// and rendered by a fifth. Put it in any one of those hooks and the other three
// import a sibling.
//
// So it is created FIRST, and every later hook takes `setMessage` as a creation
// argument. That is the playbook §5 rule: the later-created hook may depend on
// the earlier; the reverse direction would be a call-time argument, never a
// creation dep.

import { useState } from "react";

export function useNotice() {
  const [message, setMessage] = useState<string | null>(null);
  return { message, setMessage };
}
