import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { todayInSg } from "@/lib/lessonDates";
import {
  groupRosterByLevel,
  roundProgress,
  type GradeLevel,
  type GradeWrites,
  type Level,
  type RosterStudent,
} from "@/lib/assessment";
import * as repo from "../dao/assessClass.repo";
import { percentGraded, studentsOf, toClassInfo, toLevels, toRoster } from "./assessClassRows";
import type { ClassInfo } from "../types";

// The grid's writes, bound to this route's dao. MODULE-LEVEL on purpose: a
// stable identity, so nothing that closes over it re-creates per render.
const gradeWrites: GradeWrites = {
  upsertGrades: repo.upsertGrades,
  clearGrade: repo.clearGrade,
  promoteStudent: repo.promoteStudent,
};

// State and load for assessing one class. ⚠ `load` depends on [classId] ONLY:
// editing "Assessing since" must NOT refetch — it regroups fresh/stale from the
// rows already held and rewrites the Back link. Keep the dep array verbatim
// (BATCH_D_PLAN.md RISK 4), and keep the `since` initialiser lazy (§7.95).
export function useAssessClass() {
  const params = useParams<{ classId: string }>();
  const search = useSearchParams();
  const classId = params.classId;

  // The round start. Taken from the URL when the index handed one over, so the
  // two pages always agree; otherwise today.
  const [since, setSince] = useState<string>(
    () => search.get("since") || todayInSg()
  );

  const [info, setInfo] = useState<ClassInfo | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [scale, setScale] = useState<GradeLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [classRes, levelsRes, scaleRes, enrolRes] = await Promise.all([
      repo.loadClass(classId),
      repo.loadLevels(),
      repo.loadGradeScale(),
      repo.loadEnrolments(classId),
    ]);

    const failed =
      classRes.error || levelsRes.error || scaleRes.error || enrolRes.error;
    if (failed) {
      setError(failed.message);
      setLoading(false);
      return;
    }

    setInfo(toClassInfo(classRes.data as any));

    setLevels(toLevels(levelsRes.data));
    setScale((scaleRes.data ?? []) as GradeLevel[]);

    const students = studentsOf(enrolRes.data);
    const ids = students.map((s: any) => s.id);

    const progRes = ids.length
      ? await repo.loadProgress(ids)
      : { data: [], error: null };

    if (progRes.error) {
      setError(progRes.error.message);
      setLoading(false);
      return;
    }

    setRoster(toRoster(students, progRes.data));
    setLoading(false);
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const progress = roundProgress(groupRosterByLevel(roster, levels, scale, since));
  const pct = percentGraded(progress.gradedSkills, progress.totalSkills);

  return { since, setSince, info, roster, levels, scale, loading, error, load, progress, pct, gradeWrites };
}

export type AssessClassState = ReturnType<typeof useAssessClass>;
