"use client";

// Assessment — pick a class to assess.
//
// WHAT THIS PAGE IS FOR. Assessment is a periodic EVENT, not a daily chore:
// every few months an admin tours every class and grades each child against
// their level's skills. This index is the tour's checklist — which classes are
// done for this round, and which are still outstanding.
//
// WHY "ASSESSING SINCE" LIVES HERE AND NOT ONLY ON THE GRID. A round is
// routinely multi-day. If this page always defaulted to today while the grid
// carried the date, then on day two every class assessed on day one would
// report zero — so the assessor would either re-tour them or stop trusting the
// counts. The date is therefore chosen here, carried into each class link, and
// carried back out again. It defaults to today (SGT) because the commonest case
// by far is "I am assessing now".
//
// ⚠ todayInSg(), NEVER new Date().toISOString().split("T")[0] — the latter is
// the UTC date, a day behind in Singapore before 08:00, and pairing it with a
// local getDay() is the §7.7 bug that shipped a real double-billing incident.

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { todayInSg, dayOfWeekOf, type DayOfWeek } from "@/lib/lessonDates";
import {
  groupRosterByLevel,
  roundProgress,
  type GradeLevel,
  type Level,
  type RosterStudent,
} from "@/lib/assessment";

const DAY_LABEL: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

type ClassRow = {
  id: string;
  title: string;
  day_of_week: string;
  start_time: string;
  location: string | null;
  coach: string | null;
  assessed: number;
  total: number;
  blocked: number;
};

export default function AssessmentIndexPage() {
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
      supabase
        .from("tenant_levels")
        .select("id, label, sort_order, tenant_level_skills(id, label, sort_order)")
        .order("sort_order"),
      supabase.from("skill_grade_levels").select("id, rank, label").order("rank"),
      supabase
        .from("classes")
        .select(
          "id, title, day_of_week, start_time, is_active, coaches(profiles(full_name)), locations(name)"
        )
        // ACTIVE classes only — a retired class has nobody left to assess, and
        // listing it would put permanent unfinishable work on the checklist.
        .eq("is_active", true)
        .order("day_of_week")
        .order("start_time"),
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

    const levels: Level[] = (levelsRes.data ?? []).map((l: any) => ({
      id: l.id,
      label: l.label,
      sort_order: l.sort_order,
      skills: l.tenant_level_skills ?? [],
    }));
    const scale = (scaleRes.data ?? []) as GradeLevel[];
    const classes = classesRes.data ?? [];

    // Enrolments and progress for every listed class, in two more flat reads.
    const classIds = classes.map((c: any) => c.id);
    const enrolRes = classIds.length
      ? await supabase
          .from("student_class_enrolments")
          .select("class_id, students(id, full_name, level_id)")
          .in("class_id", classIds)
          .eq("is_active", true)
      : { data: [], error: null };

    if (enrolRes.error) {
      setError(enrolRes.error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const studentIds = Array.from(
      new Set((enrolRes.data ?? []).map((e: any) => e.students?.id).filter(Boolean))
    );
    const progRes = studentIds.length
      ? await supabase
          .from("student_skill_progress")
          .select("student_id, skill_id, grade_level_id, graded_at")
          .in("student_id", studentIds)
      : { data: [], error: null };

    if (progRes.error) {
      setError(progRes.error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const progressByStudent = new Map<string, any[]>();
    for (const p of progRes.data ?? []) {
      const list = progressByStudent.get((p as any).student_id) ?? [];
      list.push(p);
      progressByStudent.set((p as any).student_id, list);
    }

    const rosterByClass = new Map<string, RosterStudent[]>();
    for (const e of enrolRes.data ?? []) {
      const s = (e as any).students;
      if (!s) continue;
      const list = rosterByClass.get((e as any).class_id) ?? [];
      list.push({
        id: s.id,
        full_name: s.full_name,
        level_id: s.level_id,
        progress: (progressByStudent.get(s.id) ?? []) as any,
      });
      rosterByClass.set((e as any).class_id, list);
    }

    const today = dayOfWeekOf(todayInSg());

    const built: ClassRow[] = classes.map((c: any) => {
      const roster = rosterByClass.get(c.id) ?? [];
      const p = roundProgress(groupRosterByLevel(roster, levels, scale, since));
      return {
        id: c.id,
        title: c.title,
        day_of_week: c.day_of_week,
        start_time: c.start_time,
        location: c.locations?.name ?? null,
        coach: c.coaches?.profiles?.full_name ?? null,
        assessed: p.assessedStudents,
        total: p.totalStudents,
        blocked: p.blockedStudents,
      };
    });

    // Today's classes lead — assessment usually follows a lesson. Everything
    // else keeps the query's day/time order beneath them.
    built.sort((a, b) => {
      const at = a.day_of_week === today ? 0 : 1;
      const bt = b.day_of_week === today ? 0 : 1;
      return at - bt || a.start_time.localeCompare(b.start_time);
    });

    setRows(built);
    setLoading(false);
  }, [since]);

  useEffect(() => {
    load();
  }, [load]);

  const today = dayOfWeekOf(todayInSg()) as DayOfWeek | null;
  const outstanding = rows.filter((r) => r.assessed < r.total).length;

  return (
    <div>
      <PageHeader
        title="Assessment"
        subtitle="Grade each child against their level's skills, one class at a time."
      />

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
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
          <p className="max-w-md text-xs text-gray-500">
            Grades recorded on or after this date count as{" "}
            <span className="font-semibold">this round</span>. Anything older is
            shown greyed with its date, so a child assessed months ago is never
            mistaken for one you have already seen today.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the class list: {error}. Nothing here is a count you can
          trust until this succeeds — reload before assessing.
        </div>
      ) : null}

      {!loading && !error ? (
        <p className="mb-4 text-sm text-gray-600">
          {outstanding === 0
            ? `Every active class is fully assessed for this round.`
            : `${outstanding} of ${rows.length} ${
                rows.length === 1 ? "class" : "classes"
              } still to assess.`}
        </p>
      ) : null}

      <Table>
        <Thead>
          <Th>Class</Th>
          <Th>Day</Th>
          <Th>Coach</Th>
          <Th>Location</Th>
          <Th>This round</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="py-8 text-center text-gray-400" colSpan={5}>
                Loading…
              </Td>
            </Tr>
          ) : rows.length === 0 ? (
            <Tr>
              <Td className="py-8 text-center text-gray-400" colSpan={5}>
                No active classes.
              </Td>
            </Tr>
          ) : (
            rows.map((r) => {
              const done = r.total > 0 && r.assessed === r.total;
              return (
                <Tr key={r.id}>
                  <Td className="font-medium text-gray-900">
                    <Link
                      href={`/assessment/${r.id}?since=${since}`}
                      className="text-sky-700 hover:underline"
                    >
                      {r.title}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-gray-500">
                    {DAY_LABEL[r.day_of_week] ?? r.day_of_week}
                    {r.day_of_week === today ? (
                      <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                        Today
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-gray-500">{r.coach ?? "—"}</Td>
                  <Td className="text-gray-500">{r.location ?? "—"}</Td>
                  <Td>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-semibold " +
                        (r.total === 0
                          ? "bg-gray-100 text-gray-500"
                          : done
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700")
                      }
                    >
                      {r.total === 0
                        ? "No children"
                        : `${r.assessed} of ${r.total} assessed`}
                    </span>
                    {/* Reported apart from done and outstanding on purpose: a
                        child with no level is not work the assessor can do, and
                        folding them into either bucket is how they get missed. */}
                    {r.blocked > 0 ? (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                        {r.blocked} {r.blocked === 1 ? "child needs" : "children need"} a level
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              );
            })
          )}
        </Tbody>
      </Table>
    </div>
  );
}
