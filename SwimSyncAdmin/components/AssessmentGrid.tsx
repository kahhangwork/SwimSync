"use client";

// The grading grid: one sub-table per level present, a row per child, a cell
// per skill. Shared by the Assessment tab's class page and the Students page's
// per-child drawer, so the two can never disagree about what a grade means.
//
// ── TWO WAYS TO ENTER A GRADE, AND WHY ───────────────────────────────────────
// CYCLE (the default): click a cell to step ungraded → lowest → … → top →
// ungraded. No modes, nothing to remember, and it is how the coach app did it.
// PAINT (a toggle): arm one grade, then click cells to stamp it. An assessment
// day awards the same grade to runs of children, and cycling to "Mastered"
// costs three clicks per cell. Paint costs one.
//
// ── SAVING: IMMEDIATE, AND A STROKE IS ONE REQUEST ───────────────────────────
// Every change writes straight away — no Save button, nothing to lose by
// closing the tab, and it matches every other write in this panel. But painting
// twenty cells must not be twenty requests, so paint collects a STROKE and
// flushes it as a single array upsert once the clicking stops.
//
// Three failure modes that array upsert has, each handled here rather than
// hoped about (docs/plans/GRADING_ADMIN_ONLY_PLAN.md, RISK 4):
//
//   (a) Postgres refuses an ENTIRE `ON CONFLICT DO UPDATE` whose array names
//       one conflict key twice. A stroke that re-crosses a cell — which happens
//       constantly — would fail every cell in it. dedupeStroke() collapses the
//       array first; it is a correctness step, not tidiness.
//   (b) One bad cell fails the whole atomic statement while the optimistic UI
//       already shows all of them painted. So a failed stroke restores the
//       WHOLE-STROKE snapshot *and* refetches, rather than trusting local state
//       to still be true.
//   (c) ⚠ PAINT MODE NEVER PAINTS "NOT SET". Clearing a grade is a DELETE, not
//       an upsert, so it cannot ride in the batch — the pair of requests could
//       half-succeed. Clearing stays a per-cell cycle action. Do not add a
//       "clear" swatch to the paint toolbar.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cycleGrade } from "@/lib/skillProgress";
import {
  groupRosterByLevel,
  canPromote,
  nextLevel,
  dedupeStroke,
  type GradeLevel,
  type Level,
  type RosterStudent,
  type StudentRow,
  type StrokeCell,
} from "@/lib/assessment";
// A grade's date is SINGAPORE's, never the viewing device's — same axis as
// isFreshGrade's boundary. toSgDate() takes the timestamptz to the SGT calendar
// date; formatSgDate() renders that date and pins UTC so it cannot drift back.
import { toSgDate, formatSgDate } from "@/lib/lessonDates";

/** How long the clicking must stop before a paint stroke is sent. */
const STROKE_IDLE_MS = 350;

type Props = {
  tenantId: string;
  roster: RosterStudent[];
  levels: Level[];
  scale: GradeLevel[];
  /** Round start, YYYY-MM-DD. Grades from this day on read as fresh. */
  since: string;
  /** Re-read everything from the server. Called after any failed write. */
  onReload: () => void | Promise<void>;
  /** Hide the paint toolbar — the single-child drawer has no run to paint. */
  compact?: boolean;
};

export function AssessmentGrid({
  tenantId,
  roster,
  levels,
  scale,
  since,
  onReload,
  compact = false,
}: Props) {
  // skill_id → grade_level_id, per student. Seeded from the roster and then
  // driven optimistically; the server is re-read on any failure.
  const [grades, setGrades] = useState<Record<string, Record<string, string>>>({});
  const [armed, setArmed] = useState<GradeLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // The pending stroke, plus the snapshot to roll back to if it fails. Refs, not
  // state: the flush timer closes over them and must see the latest value.
  const stroke = useRef<StrokeCell[]>([]);
  const strokeSnapshot = useRef<Record<string, Record<string, string>> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const seeded: Record<string, Record<string, string>> = {};
    for (const s of roster) {
      seeded[s.id] = Object.fromEntries(
        s.progress.map((p) => [p.skill_id, p.grade_level_id])
      );
    }
    setGrades(seeded);
  }, [roster]);

  // Escape disarms. A mode you cannot see is a mode that mis-records a grade,
  // so it must always be one keystroke from off.
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  // Leaving the screen disarms, and flushes anything still pending — an unsent
  // stroke is work the assessor believes is already saved.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const flushStroke = useCallback(async () => {
    const cells = dedupeStroke(stroke.current);
    const snapshot = strokeSnapshot.current;
    stroke.current = [];
    strokeSnapshot.current = null;
    if (cells.length === 0) return;

    setBusy(true);
    const { error: err } = await supabase
      .from("student_skill_progress")
      .upsert(cells, { onConflict: "student_id,skill_id" });
    setBusy(false);

    if (err) {
      // The statement is atomic: if it failed, NOTHING in it was written. Undo
      // the whole stroke rather than the last cell, then re-read — local state
      // is no longer evidence of what the server holds.
      if (snapshot) setGrades(snapshot);
      setError(
        "That batch of grades could not be saved, so none of them were. The grid has been reloaded from the server."
      );
      await onReload();
    }
  }, [onReload]);

  function queueStroke(next: StrokeCell, snapshot: Record<string, Record<string, string>>) {
    if (stroke.current.length === 0) strokeSnapshot.current = snapshot;
    stroke.current.push(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushStroke(), STROKE_IDLE_MS);
  }

  async function writeOne(cell: StrokeCell | null, studentId: string, skillId: string,
                          snapshot: Record<string, Record<string, string>>) {
    setBusy(true);
    const { error: err } = cell
      ? await supabase
          .from("student_skill_progress")
          .upsert([cell], { onConflict: "student_id,skill_id" })
      : await supabase
          .from("student_skill_progress")
          .delete()
          .eq("student_id", studentId)
          .eq("skill_id", skillId);
    setBusy(false);

    if (err) {
      setGrades(snapshot);
      setError("Could not save that grade. The grid has been reloaded.");
      await onReload();
    }
  }

  function applyLocal(studentId: string, skillId: string, gradeId: string | null) {
    setGrades((g) => {
      const forStudent = { ...(g[studentId] ?? {}) };
      if (gradeId) forStudent[skillId] = gradeId;
      else delete forStudent[skillId];
      return { ...g, [studentId]: forStudent };
    });
  }

  function onCellClick(studentId: string, skillId: string) {
    setError(null);
    const snapshot = grades;

    if (armed) {
      // Paint. Never clears — see (c) in the header.
      applyLocal(studentId, skillId, armed.id);
      queueStroke(
        { student_id: studentId, skill_id: skillId, tenant_id: tenantId, grade_level_id: armed.id },
        snapshot
      );
      return;
    }

    // Cycle. A single cell, so it goes straight out rather than through the
    // stroke buffer — there is nothing to batch it with.
    const currentId = grades[studentId]?.[skillId] ?? null;
    const current = currentId ? scale.find((g) => g.id === currentId) ?? null : null;
    const next = cycleGrade(current, scale);
    applyLocal(studentId, skillId, next?.id ?? null);
    void writeOne(
      next
        ? { student_id: studentId, skill_id: skillId, tenant_id: tenantId, grade_level_id: next.id }
        : null,
      studentId,
      skillId,
      snapshot
    );
  }

  function onPaintRow(row: StudentRow) {
    if (!armed) return;
    setError(null);
    const snapshot = grades;
    for (const cell of row.cells) {
      applyLocal(row.student.id, cell.skill.id, armed.id);
      queueStroke(
        {
          student_id: row.student.id,
          skill_id: cell.skill.id,
          tenant_id: tenantId,
          grade_level_id: armed.id,
        },
        snapshot
      );
    }
  }

  async function onPromote(row: StudentRow, to: Level) {
    setPromoting(row.student.id);
    setError(null);
    const { error: err } = await supabase
      .from("students")
      .update({ level_id: to.id })
      .eq("id", row.student.id);
    setPromoting(null);

    if (err) {
      setError(`Could not move ${row.student.full_name} up: ${err.message}`);
      return;
    }
    // The row physically moves to another sub-table, which is disorienting
    // without a word about it. Say what happened, then re-read.
    setFlash(`${row.student.full_name} moved up to ${to.label}.`);
    await onReload();
  }

  // Rebuild from the optimistic grades, so a click re-renders immediately while
  // its write is still in flight.
  const optimisticRoster: RosterStudent[] = roster.map((s) => {
    const byId = new Map(s.progress.map((p) => [p.skill_id, p]));
    const current = grades[s.id] ?? {};
    const progress = Object.entries(current).map(([skill_id, grade_level_id]) => {
      const existing = byId.get(skill_id);
      return {
        skill_id,
        grade_level_id,
        // A grade the assessor just changed is by definition from this round.
        graded_at:
          existing && existing.grade_level_id === grade_level_id
            ? existing.graded_at
            : new Date().toISOString(),
      };
    });
    return { ...s, progress };
  });

  const groups = groupRosterByLevel(optimisticRoster, levels, scale, since);

  return (
    <div>
      {!compact && scale.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
          <span className="text-xs font-semibold text-gray-600">Paint:</span>
          {scale.map((g) => (
            <button
              key={g.id}
              onClick={() => setArmed(armed?.id === g.id ? null : g)}
              className={
                "rounded-full px-3 py-1.5 text-xs font-semibold transition " +
                (armed?.id === g.id
                  ? "bg-sky-600 text-white ring-2 ring-sky-300"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200")
              }
            >
              {g.label}
            </button>
          ))}
          {armed ? (
            <button
              onClick={() => setArmed(null)}
              className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Done painting (Esc)
            </button>
          ) : null}
          <span className="ml-auto text-xs text-gray-500">
            {armed
              ? `Click a cell to mark it ${armed.label}.`
              : "Click a cell to cycle its grade, or pick a grade to paint."}
          </span>
        </div>
      ) : null}

      {armed ? (
        // Loud on purpose. An armed grade the assessor has forgotten about is
        // how a wrong record gets written with a confident click.
        <div className="mb-3 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          Painting <span className="font-bold">{armed.label}</span> — every cell
          you click is marked {armed.label}. Press Esc to stop.
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {flash ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} className="text-xs font-semibold">
            Dismiss
          </button>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No children on this roster.
        </p>
      ) : null}

      <div className="space-y-6">
        {groups.map((group) => {
          const up = group.level ? nextLevel(levels, group.level.id) : null;
          return (
            <div
              key={group.level?.id ?? "no-level"}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white"
            >
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5">
                <h3 className="text-sm font-bold text-gray-900">
                  {group.level ? group.level.label : "No level set"}
                </h3>
                <p className="text-xs text-gray-500">
                  {group.rows.length}{" "}
                  {group.rows.length === 1 ? "child" : "children"}
                  {group.level ? ` · ${group.level.skills.length} skills` : ""}
                </p>
              </div>

              {/* ⚠ The grid scrolls INSIDE this container. A level with many
                  skills must never make the page itself scroll sideways. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      {/* ⚠ STICKY ONLY FROM sm: UP — see the <td> below. */}
                      <th className="bg-white px-4 py-2 text-xs font-semibold text-gray-500 sm:sticky sm:left-0 sm:z-10">
                        Child
                      </th>
                      {(group.level?.skills ?? [])
                        .slice()
                        .sort(
                          (a, b) =>
                            a.sort_order - b.sort_order ||
                            a.label.localeCompare(b.label)
                        )
                        .map((s) => (
                          <th
                            key={s.id}
                            className="px-2 py-2 text-xs font-semibold text-gray-500"
                          >
                            {s.label}
                          </th>
                        ))}
                      <th className="px-4 py-2 text-xs font-semibold text-gray-500">
                        This round
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.student.id} className="border-b border-gray-50">
                        {/* ⚠ STICKY ONLY FROM sm: UP, AND THAT IS A BUG FIX,
                            NOT A PREFERENCE. verify-assessment.mjs caught this
                            at 390px on its first run: a sticky name column
                            pinned at left:0 sits ON TOP of the cells that
                            scroll under it, so the FIRST skill of every row
                            became untappable on a phone — "<td …> intercepts
                            pointer events". Poolside on a phone is the real
                            assessor's actual situation (the mobile app went
                            read-only in this same release), so an untappable
                            first column is not a cosmetic issue.

                            Below sm the row scrolls as one unit: nothing
                            overlays anything, every cell is reachable, and the
                            name truncates so a long one cannot eat the
                            viewport. From sm up there is room for both, and the
                            pinned name is worth having. */}
                        <td
                          title={row.student.full_name}
                          className="max-w-[8rem] truncate bg-white px-4 py-2 font-medium text-gray-900 sm:max-w-none sm:sticky sm:left-0 sm:z-10"
                        >
                          {row.student.full_name}
                        </td>

                        {row.noSkills ? (
                          <td className="px-2 py-2 text-xs text-gray-500" colSpan={1}>
                            {group.level
                              ? "This level has no skills yet — add them on the Levels page."
                              : "Set a level on the Students page before assessing."}
                          </td>
                        ) : (
                          row.cells.map((cell) => (
                            <td key={cell.skill.id} className="px-2 py-2">
                              <button
                                onClick={() =>
                                  onCellClick(row.student.id, cell.skill.id)
                                }
                                disabled={busy}
                                title={
                                  cell.gradedAt
                                    ? `Last graded ${formatSgDate(
                                        toSgDate(cell.gradedAt),
                                        {
                                          day: "numeric",
                                          month: "short",
                                          year: "numeric",
                                        }
                                      )}`
                                    : "Not yet graded"
                                }
                                className={
                                  "min-w-[5.5rem] rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 " +
                                  (!cell.grade
                                    ? "bg-gray-100 text-gray-400 hover:bg-gray-200"
                                    : !cell.fresh
                                    ? // STALE: a previous round's grade. Greyed
                                      // and dated, so a full row of old grades
                                      // can never be mistaken for today's work.
                                      "bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-200 hover:bg-gray-100"
                                    : cell.done
                                    ? "bg-green-100 text-green-800 hover:bg-green-200"
                                    : "bg-sky-100 text-sky-800 hover:bg-sky-200")
                                }
                              >
                                {cell.grade ? cell.grade.label : "—"}
                                {cell.grade && !cell.fresh && cell.gradedAt ? (
                                  <span className="ml-1 font-normal">
                                    ·{" "}
                                    {formatSgDate(toSgDate(cell.gradedAt), {
                                      day: "numeric",
                                      month: "short",
                                    })}
                                  </span>
                                ) : null}
                              </button>
                            </td>
                          ))
                        )}

                        <td className="whitespace-nowrap px-4 py-2">
                          {row.noSkills ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                              Needs a level
                            </span>
                          ) : row.assessedThisRound ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              {row.freshCount}/{row.total} ✓
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              {row.freshCount}/{row.total}
                            </span>
                          )}

                          {/* A child assessed on their old level and then moved
                              lands here with no fresh grades. Without this they
                              read as untouched on the day they were assessed. */}
                          {row.promotedThisRound && row.freshCount === 0 ? (
                            <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                              Promoted this round
                            </span>
                          ) : null}

                          {armed && !row.noSkills ? (
                            <button
                              onClick={() => onPaintRow(row)}
                              disabled={busy}
                              className="ml-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                            >
                              All {armed.label}
                            </button>
                          ) : null}

                          {/* Offered ONLY off this round's own grades — see
                              canPromote(). Promoting off months-old grades
                              would move a child nobody has looked at today. */}
                          {up && canPromote(row) ? (
                            <button
                              onClick={() => void onPromote(row, up)}
                              disabled={promoting === row.student.id}
                              className="ml-2 rounded-lg border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                            >
                              {promoting === row.student.id
                                ? "Moving…"
                                : `Move up to ${up.label} →`}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
