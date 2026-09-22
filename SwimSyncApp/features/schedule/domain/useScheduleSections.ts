// The Schedule tab's sections: the location filter, the expanded days, the
// week-selector bounds, and the RENDER-TIME de-duplication that puts every
// lesson in exactly one section (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 4).
// Moved verbatim from app/(coach)/schedule/index.tsx.
//
// ⚠ ALL OF THIS IS DERIVED PER RENDER, FROM THE SAME RENDER'S INPUTS. None of
// it may move into loadData — the DE-DUPLICATION comment below says why (a
// lesson would land in neither section).
import React, { useState } from "react";
import { router } from "expo-router";
import { backlogWindowStart } from "@/lib/lessonDates";
import { selectableWeekOffsets } from "@/lib/scheduleWeek";
import { bucketWeek } from "@/lib/scheduleBuckets";
import { locationChips } from "@/lib/locationFilter";
import type { WeekLesson, BacklogItem } from "../types";

export function useScheduleSections({
  todayDate,
  showsTodaySection,
  needsMarking,
  weekLessons,
  floor,
}: {
  todayDate: string;
  showsTodaySection: boolean;
  needsMarking: BacklogItem[];
  weekLessons: WeekLesson[];
  floor: string | null;
}) {
  // "" = all locations. Filters the WEEK buckets only — NEEDS MARKING stays
  // floor-scoped and ignores it, the same way it ignores the week selector, so a
  // straggler at another location is never hidden.
  const [locationFilter, setLocationFilter] = useState<string>("");
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  // Derived AFTER the load: it needs the business's floor.
  const bounds = selectableWeekOffsets(
    todayDate,
    backlogWindowStart(todayDate, null, floor)
  );

  // ── DE-DUPLICATION, IN THE RENDER BODY ────────────────────────────────────
  // Today's unmarked lesson belongs in TODAY (where it has a button), not in
  // both sections. Deriving this here — from the same render's `needsMarking`
  // and `showsTodaySection` — means the two values cannot disagree. Doing it
  // inside loadData would make a week that re-renders without refetching show
  // neither, and today's lesson would be unmarkable from the landing tab.
  const visibleNeedsMarking = needsMarking.filter(
    (i) => !(showsTodaySection && i.date === todayDate)
  );

  // A lesson appears in EXACTLY ONE section. Anything already listed under
  // NEEDS MARKING is pulled out of the week's own buckets, or an unmarked past
  // lesson would render twice — once as a nag and once under DONE, which reads
  // as "finished" and is the opposite of true. (Today's lesson goes the other
  // way: bucketWeek puts it in `today`, and the filter above keeps it out of
  // NEEDS MARKING so it keeps its Mark button.)
  const needsKeys = new Set(
    visibleNeedsMarking.map((i) => `${i.class_id}:${i.date}`)
  );
  // Distinct locations across the week's lessons, for the filter chips.
  const scheduleLocationOpts = React.useMemo(
    () => locationChips(weekLessons.map((l) => ({ id: l.locationId, name: l.location }))),
    [weekLessons]
  );

  // Clamp to "all" when the selected location has no lessons this week — else the
  // chips disappear (options ≤ 1) while the filter renders the week empty with no
  // control to clear it.
  const effLocationFilter = scheduleLocationOpts.some((o) => o.id === locationFilter)
    ? locationFilter
    : "";
  const buckets = bucketWeek(
    weekLessons
      .filter((l) => !needsKeys.has(`${l.classId}:${l.date}`))
      .filter((l) => !effLocationFilter || l.locationId === effLocationFilter),
    todayDate
  );
  const todayLessons = showsTodaySection ? buckets.today : [];
  const todayStudents = todayLessons.reduce((s, l) => s + l.students, 0);
  const todayGuests = todayLessons.reduce((s, l) => s + l.guests, 0);

  const toggleDay = (date: string) =>
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  // ⚠ `sessionId` IS DELIBERATELY NOT PASSED. The attendance screen resolves
  // the session from (class_id, date) itself and no longer accepts one from the
  // URL — it used to trust it without checking that it belonged to this class
  // or this date. `l.sessionId` is still carried in the item because the
  // sections use it to render marking state; it is simply not navigation input.
  const openAttendance = (l: { classId: string; date: string; sessionId: string | null }) =>
    router.push(
      `/(coach)/classes/${l.classId}/attendance?date=${l.date}&from=schedule`
    );

  return {
    bounds,
    setLocationFilter,
    expandedDays,
    visibleNeedsMarking,
    scheduleLocationOpts,
    effLocationFilter,
    buckets,
    todayLessons,
    todayStudents,
    todayGuests,
    toggleDay,
    openAttendance,
  };
}
