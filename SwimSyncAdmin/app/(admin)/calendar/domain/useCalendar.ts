import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { lessonHref } from "@/components/calendar/LessonTooltip";
import {
  buildCalendarLessons,
  isCalendarView,
  locationOptions,
  rangeForView,
  type CalendarLesson,
  type CalendarView,
} from "@/lib/calendarLessons";
import { todayInSg } from "@/lib/lessonDates";
import { nowMinutesInSg } from "@/lib/timeOfDay";
import { loadCalendarData, type CalendarData } from "../dao/calendar.repo";
import { calendarSummary, expandDays, rangeLabel, visibleLessons } from "./calendarRows";

type Tip = { lesson: CalendarLesson; x: number; y: number } | null;

export type SetParams = (
  next: Partial<{ view: CalendarView; date: string; location: string; coach: string }>
) => void;

// All admin-Calendar state, effects and derivations. NO DATE IN STATE (§7.95):
// view/anchor/filters live in the URL; today/now are read per render.
export function useCalendar() {
  const router = useRouter();
  const params = useSearchParams();

  const viewParam = params.get("view");
  const view: CalendarView = isCalendarView(viewParam) ? viewParam : "day";
  const dateParam = params.get("date");
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInSg();
  const location = params.get("location") ?? "";
  const coach = params.get("coach") ?? "";

  const setParams: SetParams = useCallback(
    (next) => {
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

  // Read per render so a long-lived tab is never stale; inputs to the pure
  // builder, never state.
  const today = todayInSg();
  const nowMinutes = nowMinutesInSg();

  const allLessons = useMemo(
    () => (data ? buildCalendarLessons({ range, today, nowMinutes, ...data }) : []),
    [data, range, today, nowMinutes]
  );
  const lessons = useMemo(
    () => visibleLessons(allLessons, location, coach),
    [allLessons, location, coach]
  );
  const locations = useMemo(() => locationOptions(data?.classes ?? []), [data]);

  const [hover, setHover] = useState<Tip>(null);
  const [pinned, setPinned] = useState<Tip>(null);

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

  const days = useMemo(() => expandDays(range), [range]);
  const tooltip = pinned ?? hover;
  const summary = calendarSummary(loading, lessons.length, allLessons.length);

  return {
    view,
    anchor,
    location,
    coach,
    setParams,
    label: rangeLabel(view, anchor),
    loading,
    error,
    data,
    allLessons,
    lessons,
    locations,
    days,
    today,
    pinned,
    tooltip,
    summary,
    reload: () => setReloadTick((t) => t + 1),
    clearPin: () => setPinned(null),
    onHover,
    onPin,
    onOpen,
  };
}

export type CalendarState = ReturnType<typeof useCalendar>;
