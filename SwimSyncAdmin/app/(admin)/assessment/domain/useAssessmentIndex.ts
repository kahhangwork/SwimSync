import { useCallback, useEffect, useState } from "react";
import { todayInSg, dayOfWeekOf, type DayOfWeek } from "@/lib/lessonDates";
import type { GradeLevel } from "@/lib/assessment";
import * as repo from "../dao/assessment.repo";
import { buildClassRows, studentIdsOf, toLevels } from "./assessmentRows";
import type { ClassRow } from "../types";

// The Assessment index's state and load. ⚠ `load` depends on [since] and the
// effect on [load]: changing "Assessing since" REFETCHES the checklist. Keep
// both dep arrays verbatim (BATCH_D_PLAN.md RISK 4) — and keep the `since`
// initialiser lazy (§7.95).
export function useAssessmentIndex() {
  const [since, setSince] = useState<string>(() => todayInSg());
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Three flat queries rather than one deep embed. A to-many embed under a
    // filter is the §7.216 trap: a plain embed returns null embeds and an
    // !inner embed narrows the PARENT rows, either of which would silently drop
    // classes or children from a checklist whose whole job is completeness.
    const [levelsRes, scaleRes, classesRes] = await Promise.all([
      repo.loadLevels(),
      repo.loadGradeScale(),
      repo.loadActiveClasses(),
    ]);

    // Errors are surfaced, never swallowed: an empty checklist that is really a
    // failed query reads as "everything is done", which is the one wrong answer
    // this page must never give.
    const failed = levelsRes.error || scaleRes.error || classesRes.error;
    if (failed) {
      setError(failed.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const levels = toLevels(levelsRes.data);
    const scale = (scaleRes.data ?? []) as GradeLevel[];
    const classes = classesRes.data ?? [];

    // Enrolments and progress for every listed class, in two more flat reads.
    const classIds = classes.map((c: any) => c.id);
    const enrolRes = classIds.length
      ? await repo.loadEnrolments(classIds)
      : { data: [], error: null };

    if (enrolRes.error) {
      setError(enrolRes.error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const studentIds = studentIdsOf(enrolRes.data);
    const progRes = studentIds.length
      ? await repo.loadProgress(studentIds)
      : { data: [], error: null };

    if (progRes.error) {
      setError(progRes.error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const today = dayOfWeekOf(todayInSg());

    setRows(buildClassRows(classes, enrolRes.data, progRes.data, levels, scale, since, today));
    setLoading(false);
  }, [since]);

  useEffect(() => {
    load();
  }, [load]);

  const today = dayOfWeekOf(todayInSg()) as DayOfWeek | null;
  const outstanding = rows.filter((r) => r.assessed < r.total).length;

  return { since, setSince, rows, loading, error, today, outstanding };
}

export type AssessmentIndexState = ReturnType<typeof useAssessmentIndex>;
