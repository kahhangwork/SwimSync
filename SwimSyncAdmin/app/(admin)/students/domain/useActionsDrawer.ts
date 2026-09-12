// Slice 9 — the per-row Actions drawer (Decision 10) and its read-only
// referral summary. Stage 10 of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md.
// Lifted from page.tsx intact.
//
// One button holds Invite/Contact/Rename/Inactive so the row keeps only the
// inline glance-and-set controls.

import { useEffect, useState } from "react";
import * as repo from "../dao/students.repo";
import type { StudentRow } from "../types";

export type ReferralSummary = { referred: boolean; brought: number };

export function useActionsDrawer() {
  const [drawerFor, setDrawerFor] = useState<StudentRow | null>(null);
  // Read-only referral summary for the drawer's parent (link to /referrals).
  const [drawerReferral, setDrawerReferral] = useState<ReferralSummary | null>(null);

  useEffect(() => {
    const pid = drawerFor?.parent_id;
    if (!pid) {
      setDrawerReferral(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [refereeRes, referrerRes] = await Promise.all([
        repo.countReferredBy(pid),
        repo.countConvertedReferrals(pid),
      ]);
      if (cancelled) return;
      setDrawerReferral({
        referred: (refereeRes.count ?? 0) > 0,
        brought: referrerRes.count ?? 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [drawerFor?.parent_id]);

  return {
    drawerFor,
    drawerReferral,
    open: (student: StudentRow) => setDrawerFor(student),
    close: () => setDrawerFor(null),
  };
}

export type ActionsDrawerState = ReturnType<typeof useActionsDrawer>;
