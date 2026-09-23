// The Child Profile screen's load and the state it writes
// (docs/refactor/BATCH_FGH_PLAN.md, App L-F). `loadChild` is moved VERBATIM from
// app/(parent)/home/child/[id].tsx — its builders are dao calls, its pure half is
// domain/childFormat; the sequence of awaits is unchanged.
//
// ⚠ `loadChild` KEEPS ITS useCallback AND ITS DEPS ([id]) — the route's
// useFocusEffect is keyed on its identity (plan ⚠ R4). `id` is read from the
// route's search params HERE, exactly as the route read it.
import { useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { ageFromDob } from "@/lib/lessonDates";
import {
  coverageByStudent,
  type StudentCoverage,
} from "@/lib/packageCoverage";
import type { GradeLevel } from "@/lib/skillProgress";
import {
  fetchStudentProfile,
  fetchParentLink,
  fetchOutstandingInvoices,
  fetchParentBalances,
  fetchGradeScale,
  fetchSkillProgress,
} from "../dao/childProfile.repo";
import { fetchPackageCoverage } from "../dao/childProfile.rpc";
import type { ChildDetail } from "../types";
import { classesOf, outstandingOf, creditOf, childDetailOf } from "./childFormat";

export function useChildProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [child, setChild] = useState<ChildDetail | null>(null);
  const [coverage, setCoverage] = useState<StudentCoverage | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(true);

  const loadChild = useCallback(async () => {
    setLoading(true);

    // Payment method for the Balances card. Fire-and-forget: a failed RPC
    // only means the line is absent, never a broken screen.
    fetchPackageCoverage()
      .then(({ data: cov }) =>
        setCoverage(coverageByStudent(cov ?? []).get(String(id)))
      );

    const { data: student } = await fetchStudentProfile(id);

    if (!student) {
      setLoading(false);
      return;
    }

    const classes = classesOf(student);

    // Fetch outstanding invoices for the parent linked to this student
    const { data: parentStudentLink } = await fetchParentLink(id);

    let outstandingAmount = 0;
    let creditBalance = 0;

    if (parentStudentLink) {
      const { data: invoices } = await fetchOutstandingInvoices(parentStudentLink.parent_id);

      outstandingAmount = outstandingOf(invoices);

      const { data: parentRecord } = await fetchParentBalances(parentStudentLink.parent_id);

      // Summed across businesses — see the note in parent-home's homeRows.
      creditBalance = creditOf(parentRecord);
    }

    // The business's grade scale and this child's grades. Scoped to the CHILD's
    // tenant, not the parent's — a parent with children at two businesses would
    // otherwise pull both scales and their ranks would collide. Read-only here;
    // the coach does the grading.
    const [{ data: scaleRows }, { data: progressRows }] = await Promise.all([
      fetchGradeScale((student as any).tenant_id),
      fetchSkillProgress(id),
    ]);

    setChild(
      childDetailOf(
        student,
        classes,
        scaleRows as GradeLevel[] | null,
        progressRows as any[] | null,
        outstandingAmount,
        creditBalance
      )
    );

    setLoading(false);
  }, [id]);

  // Age is never stored — date_of_birth is the fact (see ageFromDob). The route
  // used to derive it after its loading guard; it is a pure function of `child`,
  // so deriving it here on every render yields the same value wherever it is read.
  const age = ageFromDob(child?.date_of_birth ?? null);

  return { child, coverage, loading, loadChild, age };
}
