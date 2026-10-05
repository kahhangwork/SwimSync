"use client";

// The prev/next strip's state: the day's lessons (the Calendar's own read, one
// date), where this lesson sits among them, and a guarded `go`.
//
// ⚠ LOADS ONCE PER LESSON VISIT, plus once per real change of teaching coach —
// NEVER once per Save. The load is keyed on `navKey` (the page's resolved
// teaching coach), which a Save's reload does not change; assigning or
// removing a substitute does, so the strip regroups to match the Coaches panel
// (plan RISK 3/6).
//
// ⚠ `go` NEVER NAVIGATES AWAY FROM UNSAVED MARKS OR A RUNNING WRITE. While a
// save/cancel/assign/book is in flight it does nothing — leaving would hide its
// refusal (a CN001, a guard) and the admin would believe it saved. With unsaved
// marks it opens the leave modal instead of pushing (plan RISK 2). The pending
// href lives here, not in ui/: the page unmounts its body on every reload
// (§7.249).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildCalendarLessons } from "@/lib/calendarLessons";
import { todayInSg } from "@/lib/lessonDates";
import { nowMinutesInSg } from "@/lib/timeOfDay";
import { loadCalendarData, type CalendarData } from "../dao/lessonNav.repo";
import { lessonNav } from "./lessonNav";
import type { LessonDetail } from "./useLessonDetail";

export type LessonNavStatus = "loading" | "ready" | "unavailable" | "none";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function useLessonNav(input: {
  classId: string;
  date: string;
  ld: Pick<LessonDetail, "loading" | "attr" | "dirty">;
  /** Any write in flight on the page (save, cancel/restore, substitute, booking). */
  busy: boolean;
}) {
  const { classId, date, ld, busy } = input;
  const router = useRouter();
  const validDate = ISO_DATE.test(date);

  // The page's teaching coach, once it has loaded. "none" = loaded, no coach.
  const [navKey, setNavKey] = useState<string | null>(null);
  useEffect(() => {
    if (!ld.loading && ld.attr) setNavKey(ld.attr.mainId ?? "none");
  }, [ld.loading, ld.attr]);

  const [loaded, setLoaded] = useState<{ key: string; data: CalendarData } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!validDate || navKey === null) return;
    let stale = false;
    loadCalendarData({ from: date, to: date }).then((res) => {
      if (stale) return;
      if (res.ok) {
        setLoaded({ key: navKey, data: res.data });
        setFailedKey(null);
      } else {
        setFailedKey(navKey);
      }
    });
    return () => {
      stale = true;
    };
  }, [date, navKey, validDate]);

  // Read per render, never held (§7.95).
  const today = todayInSg();
  const nowMinutes = nowMinutesInSg();
  const currentMainId = ld.attr?.mainId ?? null;
  // Only data loaded FOR the current coach counts — after a cover change the
  // old data would group by the old coach and briefly hide the strip.
  const fresh = loaded && loaded.key === navKey ? loaded.data : null;
  const nav = useMemo(
    () =>
      fresh
        ? lessonNav(
            buildCalendarLessons({ range: { from: date, to: date }, today, nowMinutes, ...fresh }),
            classId,
            date,
            currentMainId
          )
        : null,
    [fresh, date, today, nowMinutes, classId, currentMainId]
  );

  const status: LessonNavStatus = !validDate
    ? "none"
    : failedKey !== null && failedKey === navKey
      ? "unavailable"
      : !fresh
        ? "loading"
        : nav
          ? "ready"
          : "none";

  const [pending, setPending] = useState<string | null>(null);

  function go(href: string | null) {
    if (!href || busy) return;
    if (ld.dirty) {
      setPending(href);
      return;
    }
    router.push(href);
  }

  return {
    status,
    nav,
    busy,
    go,
    leaveOpen: pending !== null,
    stay: () => setPending(null),
    leave: () => {
      const href = pending;
      setPending(null);
      if (href) router.push(href);
    },
  };
}

export type LessonNavState = ReturnType<typeof useLessonNav>;
