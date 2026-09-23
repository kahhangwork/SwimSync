// The parent Home tab's spine: the load, the claim dismissal and the state they
// write (docs/refactor/BATCH_FGH_PLAN.md, App L-F). `loadData` is moved VERBATIM
// from app/(parent)/home/index.tsx — its builders are dao calls now, its pure
// half is domain/homeRows; nothing else changed.
//
// ⚠ `loadData` KEEPS ITS useCallback AND ITS DEPS ([session]), BYTE-IDENTICAL.
// The route's useFocusEffect AND the signup-join-code effect are both keyed on
// its identity — a churning loadData would refetch in a loop and re-fire
// join_tenant_by_code (plan ⚠ R4).
import { useState, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import {
  coverageByStudent,
  type StudentCoverage,
} from "@/lib/packageCoverage";
import {
  fetchParentHome,
  fetchUpcomingTrials,
  fetchUpcomingMakeups,
  fetchOutstandingInvoices,
  fetchOpenClaims,
} from "../dao/parentHome.repo";
import { fetchPackageCoverage, dismissStudentClaim } from "../dao/parentHome.rpc";
import type { Child, PendingClaim } from "../types";
import {
  totalCredit,
  mapChildren,
  firstBookingByStudent,
  totalOutstandingOf,
} from "./homeRows";

export function useParentHome() {
  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);
  const [children, setChildren] = useState<Child[]>([]);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );
  const [creditBalance, setCreditBalance] = useState(0);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<PendingClaim[]>([]);

  /** Clear a decided notice. Only ever offered on a DECLINED claim — a pending
   *  one is what explains why this parent cannot re-add that child. */
  async function dismissClaim(id: string) {
    setClaims((cs) => cs.filter((c) => c.id !== id)); // optimistic
    await dismissStudentClaim(id);
  }

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    // Payment-method badges. Fire-and-forget: a failed RPC only means no
    // badges, never a broken home screen. RLS scopes the rows to this family.
    fetchPackageCoverage()
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));

    // Fetch parent record with children and their enrolments
    const { data: parent } = await fetchParentHome(session);

    if (parent) {
      // Credit is held PER BUSINESS (domain/homeRows totalCredit says why).
      setCreditBalance(totalCredit(parent));

      const mapped: Child[] = mapChildren(parent);

      // ⚠ A TRIAL IS NOT AN ENROLMENT, so a child who only has one booked reads
      // as "unassigned" — and the card then told the family "the admin will
      // assign your child soon", which is false and unhelpful: their lesson is
      // already booked, at a known class on a known date, and the app was the
      // only thing that knew. Reported from production 2026-07-26.
      const ids = mapped.map((c) => c.id);
      if (ids.length > 0) {
        const [{ data: trials }, { data: makeups }] = await Promise.all([
          fetchUpcomingTrials(ids),
          // Make-ups too: an enrolled child guesting one lesson in another
          // class. WHEN and WHERE is the whole question the family has.
          fetchUpcomingMakeups(ids),
        ]);

        const byStudent = firstBookingByStudent(trials, "their class");
        for (const c of mapped) c.trial = byStudent.get(c.id) ?? null;

        const makeupByStudent = firstBookingByStudent(makeups, "another class");
        for (const c of mapped) c.makeup = makeupByStudent.get(c.id) ?? null;
      }

      setChildren(mapped);

      // Fetch total outstanding invoices for this parent
      const { data: invoices } = await fetchOutstandingInvoices(parent.id);

      const outstanding = totalOutstandingOf(invoices);
      setTotalOutstanding(outstanding);

      // Claims this family is waiting on. A parent who tapped "that's my
      // child" is BLOCKED from adding that child again until the coach
      // decides, so without this card they are left with a toast they saw once
      // and an app that appears to have done nothing. There is deliberately no
      // email chasing the admin (PARENT_CLAIM_PLAN decision 7), which makes
      // this the only thing managing the wait.
      const { data: claims } = await fetchOpenClaims(parent.id);

      setClaims((claims ?? []) as PendingClaim[]);
    }

    setLoading(false);
  }, [session]);

  return {
    session,
    showToast,
    children,
    covMap,
    creditBalance,
    totalOutstanding,
    loading,
    claims,
    dismissClaim,
    loadData,
  };
}
