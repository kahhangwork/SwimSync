"use client";

// The admin calendar — every lesson of every coach, at a glance, so a make-up
// slot can be found by colour and count.
//
// READ-ONLY BY CONSTRUCTION. This page, lib/calendarData.ts and every component
// under components/calendar/ perform no writes. Double-click (or Enter, or the
// pinned tooltip's link) opens /lessons/[classId]/[date], which is where
// attendance, substitutes and guest bookings are changed.
//
// NO DATE IN STATE (§7.95). The anchor date, view and filters live in the URL
// (`?view=&date=&location=&coach=`), so refresh/back keep position and a tab
// left open overnight does not carry yesterday's "today" — the Today button
// computes todayInSg() at click time, and a missing `date` param is derived
// per render, never stored.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { CalendarToolbar } from "@/components/calendar/CalendarToolbar";
import { TimeGrid } from "@/components/calendar/TimeGrid";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { AgendaList } from "@/components/calendar/AgendaList";
import { LessonTooltip, lessonHref } from "@/components/calendar/LessonTooltip";
import { loadCalendarData, type CalendarData } from "@/lib/calendarData";
import {
  addDays,
  buildCalendarLessons,
  isCalendarView,
  locationOptions,
  rangeForView,
  shiftAnchor,
  type CalendarLesson,
  type CalendarView,
} from "@/lib/calendarLessons";
import { formatSgDate, todayInSg } from "@/lib/lessonDates";
import { nowMinutesInSg } from "@/lib/timeOfDay";

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
      <CalendarInner />
    </Suspense>
  );
}

function rangeLabel(view: CalendarView, anchor: string): string {
  const { from, to } = rangeForView(view, anchor);
  switch (view) {
    case "day":
      return formatSgDate(anchor, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    case "month":
      return formatSgDate(anchor, { month: "long", year: "numeric" });
    case "week":
    case "agenda":
      return `${formatSgDate(from, { day: "numeric", month: "short" })} – ${formatSgDate(to, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`;
  }
}

function CalendarInner() {
  const router = useRouter();
  const params = useSearchParams();

  // ── URL state ───────────────────────────────────────────────────────────
  const viewParam = params.get("view");
  const view: CalendarView = isCalendarView(viewParam) ? viewParam : "day";
  const dateParam = params.get("date");
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInSg();
  const location = params.get("location") ?? "";
  const coach = params.get("coach") ?? "";

  const setParams = useCallback(
    (next: Partial<{ view: CalendarView; date: string; location: string; coach: string }>) => {
      const q = new URLSearchParams(params.toString());
      const merged = { view, date: anchor, location, coach, ...next };
      q.set("view", merged.view);
      q.set("date", merged.date);
      if (merged.location) q.set("location", merged.location);
      else q.delete("location");
      if (merged.coach) q.set("coach", merged.coach);
      else q.delete("coach");
      router.replace(`/calendar?${q.toString()}`);
    },
    [params, router, view, anchor, location, coach]
  );

  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);

  // ── Data ────────────────────────────────────────────────────────────────
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

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
  }, [range.from, range.to, reloadTick]);

  // "today" and "now" are read per render so a long-lived tab is never stale;
  // they are inputs to the pure builder, never state.
  const today = todayInSg();
  const nowMinutes = nowMinutesInSg();

  const allLessons = useMemo(
    () => (data ? buildCalendarLessons({ range, today, nowMinutes, ...data }) : []),
    [data, range, today, nowMinutes]
  );

  const lessons = useMemo(
    () =>
      allLessons.filter(
        (l) => (!location || l.location === location) && (!coach || l.mainCoach.id === coach)
      ),
    [allLessons, location, coach]
  );

  const locations = useMemo(() => locationOptions(data?.classes ?? []), [data]);

  // ── Hover / pin ─────────────────────────────────────────────────────────
  const [hover, setHover] = useState<{ lesson: CalendarLesson; x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<{ lesson: CalendarLesson; x: number; y: number } | null>(null);

  const onHover = useCallback((lesson: CalendarLesson | null, e: React.MouseEvent) => {
    setHover(lesson ? { lesson, x: e.clientX, y: e.clientY } : null);
  }, []);
  const onPin = useCallback((lesson: CalendarLesson, e: React.MouseEvent) => {
    setPinned((cur) => (cur && cur.lesson.key === lesson.key ? null : { lesson, x: e.clientX, y: e.clientY }));
  }, []);
  const onOpen = useCallback(
    (lesson: CalendarLesson) => {
      setPinned(null);
      router.push(lessonHref(lesson));
    },
    [router]
  );
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned]);

  // If the pinned lesson vanished (filter/range change), drop the pin.
  useEffect(() => {
    if (pinned && !lessons.some((l) => l.key === pinned.lesson.key)) setPinned(null);
  }, [lessons, pinned]);

  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = range.from; d && d <= range.to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [range]);

  const tooltip = pinned ?? hover;

  const summary = loading
    ? "Loading…"
    : `${lessons.length} lesson${lessons.length === 1 ? "" : "s"}${
        lessons.length !== allLessons.length ? ` of ${allLessons.length}` : ""
      }`;

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Every lesson of every coach. Hover for the roster, double-click to open a lesson."
      />

      <CalendarToolbar
        view={view}
        label={rangeLabel(view, anchor)}
        onPrev={() => setParams({ date: shiftAnchor(view, anchor, -1) })}
        onNext={() => setParams({ date: shiftAnchor(view, anchor, 1) })}
        onToday={() => setParams({ date: todayInSg() })}
        onView={(v) => setParams({ view: v })}
        locations={locations}
        location={location}
        onLocation={(v) => setParams({ location: v })}
        coaches={data?.coachOptions ?? []}
        coach={coach}
        onCoach={(v) => setParams({ coach: v })}
        summary={summary}
      />

      {error && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>Could not load the calendar: {error}</span>
          <button type="button" className="font-medium underline" onClick={() => setReloadTick((t) => t + 1)}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && data.classes.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No classes yet — create one on the Classes page and it will appear here on its weekday.
        </div>
      )}

      {!loading && !error && data && data.classes.length > 0 && lessons.length === 0 && allLessons.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No lessons {location ? `at ${location}` : ""} {coach ? "for that coach" : ""} in this {view === "month" ? "month" : view === "day" ? "day" : "week"}.
          {" "}
          <button type="button" className="font-medium underline" onClick={() => setParams({ location: "", coach: "" })}>
            Clear filters
          </button>
        </div>
      )}

      {(view === "day" || view === "week") && (
        <TimeGrid
          days={days}
          lessons={lessons}
          today={today}
          laneMinPx={view === "day" ? 220 : 150}
          dayMinPx={view === "day" ? 320 : 150}
          selectedKey={pinned?.lesson.key ?? null}
          onOpen={onOpen}
          onHover={onHover}
          onPin={onPin}
          onDayClick={(date) => setParams({ view: "day", date })}
        />
      )}
      {view === "month" && (
        <MonthGrid
          anchor={anchor}
          lessons={lessons}
          today={today}
          selectedKey={pinned?.lesson.key ?? null}
          onOpen={onOpen}
          onHover={onHover}
          onPin={onPin}
          onDayOpen={(date) => setParams({ view: "day", date })}
        />
      )}
      {view === "agenda" && (
        <AgendaList
          days={days}
          lessons={lessons}
          today={today}
          selectedKey={pinned?.lesson.key ?? null}
          onOpen={onOpen}
          onHover={onHover}
          onPin={onPin}
        />
      )}

      {tooltip && (
        <LessonTooltip
          lesson={tooltip.lesson}
          x={tooltip.x}
          y={tooltip.y}
          pinned={pinned !== null}
          onClose={() => setPinned(null)}
        />
      )}

      <p className="mt-2 text-xs text-gray-400">
        Legend: <span className="font-semibold">4+1/6</span> = enrolled + guests / max ·{" "}
        <span className="text-red-600 font-semibold">(Sub)</span> = substitute coach · dashed border = attendance not
        fully marked · <span className="text-emerald-700">✓</span> = fully marked · faded = public-holiday void.
      </p>
    </div>
  );
}
