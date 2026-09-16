"use client";

// Lessons — every coach's lessons as a list grouped by day, for marking.
//
// The same data and the same pure builder as the Calendar
// (lib/calendarLessons.ts), so the two never disagree about what a lesson is
// or who is expected at it. Two modes:
//   • a WEEK (‹ › Today) — what is on;
//   • NEEDS MARKING — every lesson from the business's markable floor to today
//     that is not fully marked. FLOOR-SCOPED, never week-scoped (§7.95): a
//     forgotten lesson three weeks back must not vanish because the week moved
//     on. The floor is re-read from the database on every load, not cached.
// Click a row → /lessons/[classId]/[date]. Read-only here; the lesson page writes.
//
// Composition only (Admin L-B): state + derivations in domain/useLessons, data
// in dao/lessons.repo, markup in ui/. See docs/refactor/BATCH_B_PLAN.md.

import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useLessons } from "./domain/useLessons";
import { LessonsToolbar } from "./ui/LessonsToolbar";
import { LessonsList } from "./ui/LessonsList";

export default function LessonsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
      <LessonsInner />
    </Suspense>
  );
}

function LessonsInner() {
  const l = useLessons();

  return (
    <div>
      <PageHeader title="Lessons" subtitle="Every coach's lessons, by day. Click a lesson to mark attendance, arrange cover or book a guest." />

      <LessonsToolbar
        mode={l.mode}
        anchor={l.anchor}
        range={l.range}
        needsCount={l.needsCount}
        location={l.location}
        coach={l.coach}
        locations={l.locations}
        coachOptions={l.coachOptions}
        lessonsCount={l.lessons.length}
        setParams={l.setParams}
        bumpFloor={l.bumpFloor}
      />

      {l.error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Could not load lessons: {l.error}</div>}
      {l.loading && <p className="text-sm text-gray-400">Loading…</p>}

      {!l.loading && !l.error && l.lessons.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {l.mode === "needs" ? "Everything up to today is marked. Nothing needs attention." : "No lessons in this week."}
        </div>
      )}

      {!l.loading && l.lessons.length > 0 && (
        <LessonsList days={l.days} byDate={l.byDate} mode={l.mode} today={l.today} />
      )}
    </div>
  );
}
