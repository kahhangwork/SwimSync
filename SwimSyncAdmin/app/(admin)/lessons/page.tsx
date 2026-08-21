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

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronRight as Arrow } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { colourFor } from "@/lib/classColours";
import { loadCalendarData, type CalendarData } from "@/lib/calendarData";
import {
  addDays,
  buildCalendarLessons,
  formatCount,
  isFull,
  locationOptions,
  rangeForView,
  shiftAnchor,
  type CalendarLesson,
} from "@/lib/calendarLessons";
import { formatSgDate, todayInSg } from "@/lib/lessonDates";
import { nowMinutesInSg } from "@/lib/timeOfDay";
import { fetchMarkableFloor } from "@/lib/markableFloor";
import { markableWindowStart } from "@/lib/attendanceWindow";
import { cn } from "@/lib/utils";

export default function LessonsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
      <LessonsInner />
    </Suspense>
  );
}

const PROGRESS_LABEL: Record<CalendarLesson["progress"], { text: string; cls: string }> = {
  upcoming: { text: "Upcoming", cls: "bg-gray-100 text-gray-600" },
  unmarked: { text: "Needs marking", cls: "bg-amber-100 text-amber-800" },
  partial: { text: "Partly marked", cls: "bg-amber-100 text-amber-800" },
  complete: { text: "Marked", cls: "bg-emerald-100 text-emerald-800" },
  holiday: { text: "Holiday", cls: "bg-gray-100 text-gray-500" },
  "no-students": { text: "Nobody expected", cls: "bg-gray-100 text-gray-500" },
  cancelled: { text: "Cancelled", cls: "bg-gray-100 text-gray-500" },
};

function LessonsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const mode = params.get("mode") === "needs" ? "needs" : "week";
  const dateParam = params.get("date");
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInSg();
  const location = params.get("location") ?? "";
  const coach = params.get("coach") ?? "";

  function setParams(next: Partial<{ mode: "week" | "needs"; date: string; location: string; coach: string }>) {
    const q = new URLSearchParams(params.toString());
    const merged = { mode, date: anchor, location, coach, ...next };
    q.set("mode", merged.mode);
    q.set("date", merged.date);
    if (merged.location) q.set("location", merged.location);
    else q.delete("location");
    if (merged.coach) q.set("coach", merged.coach);
    else q.delete("coach");
    router.replace(`/lessons?${q.toString()}`);
  }

  const today = todayInSg();
  const nowMinutes = nowMinutesInSg();

  // The floor is re-read on every load (never cached at mount).
  const [floor, setFloor] = useState<string | null>(null);
  const [floorTick, setFloorTick] = useState(0);
  useEffect(() => {
    let stale = false;
    fetchMarkableFloor().then((f) => {
      if (!stale) setFloor(f);
    });
    return () => {
      stale = true;
    };
  }, [floorTick, today]);

  const range = useMemo(() => {
    if (mode === "needs") return { from: markableWindowStart(today, floor), to: today };
    return rangeForView("week", anchor);
  }, [mode, anchor, today, floor]);

  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    loadCalendarData(range).then((res) => {
      if (stale) return;
      if (res.ok) setData(res.data);
      else setError(res.error);
      setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [range.from, range.to]);

  const all = useMemo(() => (data ? buildCalendarLessons({ range, today, nowMinutes, ...data }) : []), [data, range, today, nowMinutes]);
  const lessons = useMemo(
    () =>
      all.filter(
        (l) =>
          (!location || l.location === location) &&
          (!coach || l.mainCoach.id === coach) &&
          (mode !== "needs" || l.progress === "unmarked" || l.progress === "partial")
      ),
    [all, location, coach, mode]
  );
  const needsCount = useMemo(() => all.filter((l) => l.progress === "unmarked" || l.progress === "partial").length, [all]);

  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = range.from; d && d <= range.to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [range]);
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarLesson[]>();
    for (const l of lessons) m.set(l.date, [...(m.get(l.date) ?? []), l]);
    return m;
  }, [lessons]);

  const locations = useMemo(() => locationOptions(data?.classes ?? []), [data]);

  return (
    <div>
      <PageHeader title="Lessons" subtitle="Every coach's lessons, by day. Click a lesson to mark attendance, arrange cover or book a guest." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          <button type="button" aria-pressed={mode === "week"} onClick={() => setParams({ mode: "week" })} className={cn("rounded-md px-3 py-1 font-medium", mode === "week" ? "bg-sky-500 text-white" : "text-gray-600 hover:bg-gray-100")}>
            Week
          </button>
          <button type="button" aria-pressed={mode === "needs"} data-testid="needs-marking-toggle" onClick={() => { setFloorTick((t) => t + 1); setParams({ mode: "needs" }); }} className={cn("rounded-md px-3 py-1 font-medium", mode === "needs" ? "bg-amber-500 text-white" : "text-gray-600 hover:bg-gray-100")}>
            Needs marking{mode === "week" && needsCount > 0 ? ` (${needsCount})` : ""}
          </button>
        </div>
        {mode === "week" && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous" onClick={() => setParams({ date: shiftAnchor("week", anchor, -1) })} className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Next" onClick={() => setParams({ date: shiftAnchor("week", anchor, 1) })} className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setParams({ date: todayInSg() })} className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Today
            </button>
            <span data-testid="lessons-label" className="ml-2 font-semibold text-gray-900">
              {formatSgDate(range.from, { day: "numeric", month: "short" })} – {formatSgDate(range.to, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
        )}
        {mode === "needs" && (
          <span className="text-sm text-gray-600">
            From <strong>{formatSgDate(range.from, { day: "numeric", month: "short", year: "numeric" })}</strong> (the marking floor) to today — {lessons.length} lesson{lessons.length === 1 ? "" : "s"} not fully marked.
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-sm">
          <select aria-label="Location" value={location} onChange={(e) => setParams({ location: e.target.value })} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select aria-label="Coach" value={coach} onChange={(e) => setParams({ coach: e.target.value })} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
            <option value="">All coaches</option>
            {(data?.coachOptions ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Could not load lessons: {error}</div>}
      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {!loading && !error && lessons.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {mode === "needs" ? "Everything up to today is marked. Nothing needs attention." : "No lessons in this week."}
        </div>
      )}

      {!loading && lessons.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {days
            .filter((d) => mode === "week" || (byDate.get(d) ?? []).length > 0)
            .map((d) => {
              const list = byDate.get(d) ?? [];
              return (
                <div key={d}>
                  <div className={cn("border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700", d === today && "text-sky-700")}>
                    {formatSgDate(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                    {d === today && " · Today"}
                  </div>
                  {list.length === 0 && <div className="px-4 py-2 text-xs text-gray-400">No lessons</div>}
                  {list.map((l) => {
                    const p = PROGRESS_LABEL[l.progress];
                    const full = isFull(l.enrolled, l.guests, l.capacity);
                    return (
                      <Link
                        key={l.key}
                        href={`/lessons/${l.classId}/${l.date}`}
                        data-testid="lesson-row"
                        className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 text-sm hover:bg-sky-50"
                      >
                        <span className="w-28 shrink-0 tabular-nums text-gray-600">
                          {l.start} – {l.end}
                        </span>
                        <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colourFor(l.colourKey).dot)} />
                        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                          {l.title}
                          {l.offPattern && <span className="ml-2 rounded bg-gray-100 px-1 text-[10px] text-gray-600">extra</span>}
                        </span>
                        <span className="w-44 shrink-0 truncate text-gray-700">
                          {l.mainCoach.name}
                          {l.mainCoach.isCover && <span className="ml-1 font-semibold text-red-600">(Sub)</span>}
                        </span>
                        <span className="w-28 shrink-0 truncate text-gray-500">{l.location}</span>
                        <span className={cn("w-16 shrink-0 text-right font-semibold tabular-nums", full && "text-red-600")}>
                          {formatCount(l.enrolled, l.guests, l.capacity)}
                        </span>
                        <span className={cn("w-32 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium", p.cls)}>{p.text}</span>
                        <Arrow className="h-4 w-4 shrink-0 text-gray-400" />
                      </Link>
                    );
                  })}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
