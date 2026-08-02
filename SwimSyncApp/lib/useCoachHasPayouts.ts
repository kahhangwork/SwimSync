// Does this coach have any pay to look at?
//
// ⚠ THIS RUNS IN THE COACH ROOT LAYOUT, so its blast radius is the whole coach
// app — Today, Classes and Settings, not just the tab it governs. It therefore
// CANNOT be allowed to reject into render, and it must never gate the layout's
// output. Every failure path returns `false`, which hides one tab; nothing here
// can take the app down. Keep it that way: if you add a branch, its error case
// resolves to `false`, it does not throw.
//
// WHY PAYOUTS AND NOT A RATE. "A coach is on payroll when they have a rate"
// (PRD §7.13) is the product rule, but a coach CANNOT READ THEIR OWN RATE:
// `coach_rates` has exactly one policy, `coach_rates_admin` (FOR ALL TO
// authenticated, admin-only — 20260719000400_coach_wages_schema.sql:146). RLS
// would return an empty set for every coach, so a rate-based check would hide
// the tab from everyone. `coach_payouts` is readable by its own coach
// (`coach_payouts_select`, scoped to `current_coach_id()`, line 158), so that
// is the signal.
//
// The accepted consequence: a school coach who has a rate but whose first
// payout has not been drafted yet sees no My Pay tab until the admin drafts
// payroll. That matches what the screen itself already did (it rendered the
// pay card only when `myPayouts.length > 0`), and for a private coach — who
// has no rate because their income is their parents' invoices — the tab is
// simply never there, which is the finished state and not missing setup.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAppStore } from "@/store/useAppStore";

export function useCoachHasPayouts(): boolean {
  // ⚠ KEYED TO THE SESSION, and this is not optional. The coach layout mounts
  // as part of the post-login redirect, and on the first render the Supabase
  // client may not have attached the session yet — so the query runs as an
  // anonymous caller, RLS returns zero rows, and with an empty dependency
  // array that "no payouts" answer would be permanent for the whole session.
  // The tab would simply never appear. Caught by verify-coach-wages.mjs, which
  // freezes a real payout and then could not find the tab.
  const sessionId = useAppStore((s) => s.session?.id);
  // Starts false, so the tab is ABSENT while the answer is unknown. Failing
  // towards absent rather than present means a tab never flashes in and then
  // vanishes, which reads as a bug even when the final state is right.
  const [hasPayouts, setHasPayouts] = useState(false);

  useEffect(() => {
    let alive = true;

    // No session yet — nothing to ask about, and asking would poison the
    // answer with an anonymous read.
    if (!sessionId) {
      setHasPayouts(false);
      return;
    }

    (async () => {
      try {
        // RLS scopes this to the caller's own payouts, so no filter is needed
        // — and a colleague's pay is not reachable even by asking for it.
        const { count, error } = await supabase
          .from("coach_payouts")
          .select("id", { count: "exact", head: true });

        if (!alive) return;
        setHasPayouts(!error && (count ?? 0) > 0);
      } catch {
        // Offline, database down, auth expired — all mean "don't show the
        // tab", never "take the app with you".
        if (alive) setHasPayouts(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [sessionId]);

  return hasPayouts;
}
