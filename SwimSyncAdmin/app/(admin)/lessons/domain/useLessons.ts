import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  buildCalendarLessons,
  locationOptions,
  rangeForView,
} from "@/lib/calendarLessons";
import { todayInSg } from "@/lib/lessonDates";
import { nowMinutesInSg } from "@/lib/timeOfDay";
import { markableWindowStart } from "@/lib/attendanceWindow";
import { loadCalendarData, fetchMarkableFloor, type CalendarData } from "../dao/lessons.repo";
import { lessonView } from "./lessonRows";

export type LessonsMode = "week" | "needs";

export type SetParams = (
  next: Partial<{ mode: LessonsMode; date: string; location: string; coach: string }>
) => void;

// All Lessons-list state, effects and derivations. The page reads the URL for
// mode/anchor/location/coach; the floor is re-read on every load (never cached
// at mount, §7.95).
export function useLessons() {
  const router = useRouter();
  const params = useSearchParams();
  const mode: LessonsMode = params.get("mode") === "needs" ? "needs" : "week";
  const dateParam = params.get("date");
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInSg();
  const location = params.get("location") ?? "";
  const coach = params.get("coach") ?? "";

  const setParams: SetParams = (next) => {
    const q = new URLSearchParams(params.toString());
    const merged = { mode, date: anchor, location, coach, ...next };
    q.set("mode", merged.mode);
    q.set("date", merged.date);
    if (merged.location) q.set("location", merged.location);
    else q.delete("location");
    if (merged.coach) q.set("coach", merged.coach);
    else q.delete("coach");
    router.replace(`/lessons?${q.toString()}`);
  };

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

  const all = useMemo(
    () => (data ? buildCalendarLessons({ range, today, nowMinutes, ...data }) : []),
    [data, range, today, nowMinutes]
  );
  const view = useMemo(
    () => lessonView({ all, range, mode, location, coach }),
    [all, range, mode, location, coach]
  );
  const locations = useMemo(() => locationOptions(data?.classes ?? []), [data]);

  return {
    mode,
    anchor,
    location,
    coach,
    setParams,
    bumpFloor: () => setFloorTick((t) => t + 1),
    today,
    range,
    loading,
    error,
    lessons: view.lessons,
    needsCount: view.needsCount,
    days: view.days,
    byDate: view.byDate,
    locations,
    coachOptions: data?.coachOptions ?? [],
  };
}
