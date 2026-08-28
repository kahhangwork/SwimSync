"use client";

// Assess one class: the grid, grouped by level.
//
// The `since` date arrives in the URL from the index page and is written back
// into the Back link, so a multi-day assessment round survives moving between
// classes — and survives midnight, which a page defaulting to today would not.
// Opening this page cold still defaults to today (SGT), because "I am assessing
// now" is the overwhelmingly common case.
//
// Data is read in flat queries rather than one deep embed: a to-many embed
// under a filter is the §7.216 trap, and this screen's whole job is to show
// every child, so a silently narrowed result is the one failure it must not have.

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { AssessmentGrid } from "@/components/AssessmentGrid";
import { todayInSg } from "@/lib/lessonDates";
import {
  groupRosterByLevel,
  roundProgress,
  type GradeLevel,
  type Level,
  type RosterStudent,
} from "@/lib/assessment";

type ClassInfo = {
  title: string;
  day_of_week: string;
  start_time: string;
  location: string | null;
  tenant_id: string;
};

export default function AssessClassPage() {
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
      supabase
        .from("classes")
        .select("title, day_of_week, start_time, tenant_id, locations(name)")
        .eq("id", classId)
        .single(),
      supabase
        .from("tenant_levels")
        .select("id, label, sort_order, tenant_level_skills(id, label, sort_order)")
        .order("sort_order"),
      supabase.from("skill_grade_levels").select("id, rank, label").order("rank"),
      supabase
        .from("student_class_enrolments")
        .select("students(id, full_name, level_id)")
        .eq("class_id", classId)
        .eq("is_active", true),
    ]);

    const failed =
      classRes.error || levelsRes.error || scaleRes.error || enrolRes.error;
    if (failed) {
      setError(failed.message);
      setLoading(false);
      return;
    }

    const c = classRes.data as any;
    setInfo({
      title: c.title,
      day_of_week: c.day_of_week,
      start_time: c.start_time,
      location: c.locations?.name ?? null,
      tenant_id: c.tenant_id,
    });

    setLevels(
      (levelsRes.data ?? []).map((l: any) => ({
        id: l.id,
        label: l.label,
        sort_order: l.sort_order,
        skills: l.tenant_level_skills ?? [],
      }))
    );
    setScale((scaleRes.data ?? []) as GradeLevel[]);

    const students = (enrolRes.data ?? [])
      .map((e: any) => e.students)
      .filter(Boolean);
    const ids = students.map((s: any) => s.id);

    const progRes = ids.length
      ? await supabase
          .from("student_skill_progress")
          .select("student_id, skill_id, grade_level_id, graded_at")
          .in("student_id", ids)
      : { data: [], error: null };

    if (progRes.error) {
      setError(progRes.error.message);
      setLoading(false);
      return;
    }

    const byStudent = new Map<string, any[]>();
    for (const p of progRes.data ?? []) {
      const list = byStudent.get((p as any).student_id) ?? [];
      list.push(p);
      byStudent.set((p as any).student_id, list);
    }

    setRoster(
      students.map((s: any) => ({
        id: s.id,
        full_name: s.full_name,
        level_id: s.level_id,
        progress: (byStudent.get(s.id) ?? []) as any,
      }))
    );
    setLoading(false);
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const progress = roundProgress(groupRosterByLevel(roster, levels, scale, since));
  const pct =
    progress.totalSkills === 0
      ? 0
      : Math.round((progress.gradedSkills / progress.totalSkills) * 100);

  return (
    <div>
      <PageHeader
        title={info?.title ?? "Assess class"}
        subtitle={
          info
            ? `${info.day_of_week} ${info.start_time?.slice(0, 5) ?? ""}${
                info.location ? ` · ${info.location}` : ""
              }`
            : undefined
        }
        action={
          <Link
            href={`/assessment?since=${since}`}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            ← All classes
          </Link>
        }
      />

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              Assessing since
            </span>
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value || todayInSg())}
              className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="min-w-[16rem] flex-1">
            <p className="text-sm text-gray-700">
              <span className="font-semibold">
                {progress.gradedSkills} of {progress.totalSkills}
              </span>{" "}
              skills graded this round ·{" "}
              <span className="font-semibold">
                {progress.assessedStudents} of {progress.totalStudents}
              </span>{" "}
              children done
              {/* Counted apart, never folded into either bucket: a child with
                  no level is work for whoever sets levels, not for the
                  assessor, and hiding them in "outstanding" or "done" is how
                  they get skipped. */}
              {progress.blockedStudents > 0 ? (
                <>
                  {" · "}
                  <span className="font-semibold text-gray-600">
                    {progress.blockedStudents} need a level
                  </span>
                </>
              ) : null}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-sky-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load this class: {error}. Reload before assessing — an empty
          grid here is a failed query, not an empty roster.
        </div>
      ) : null}

      {loading ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          Loading…
        </p>
      ) : info ? (
        <AssessmentGrid
          tenantId={info.tenant_id}
          roster={roster}
          levels={levels}
          scale={scale}
          since={since}
          onReload={load}
        />
      ) : null}
    </div>
  );
}
