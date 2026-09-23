// The coach Classes tab's state, the location filter, the weekday grouping and the
// load (docs/refactor/BATCH_FGH_PLAN.md, App L-H). Moved VERBATIM from
// app/(coach)/classes/index.tsx — the two useMemos and loadClasses keep their deps
// byte-identical ([classes], [classes, effLocationFilter], [shown, todayDow],
// [session]); builders are dao calls, the row mapping domain/classesFormat, the
// grouping domain/weekOrder (moved from lib/, this screen was its one importer).
// The route's useFocusEffect is keyed on loadClasses (plan ⚠ R4).
import React, { useState, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { todayInSg, dayOfWeekOf } from "@/lib/lessonDates";
import { locationChips } from "@/lib/locationFilter";
import { fetchCoach, fetchCoachClasses } from "../dao/coachClasses.repo";
import type { CoachClass } from "../types";
import { classesOf } from "./classesFormat";
import { groupByWeekday } from "./weekOrder";

export function useCoachClasses() {
  const session = useAppStore((s) => s.session);
  const [classes, setClasses] = useState<CoachClass[]>([]);
  const [loading, setLoading] = useState(true);
  // "" = all locations. A coach who teaches at one location never sees the chips.
  const [locationFilter, setLocationFilter] = useState<string>("");

  // Distinct locations across this coach's classes, for the filter chips.
  const locationOpts = React.useMemo(
    () => locationChips(classes.map((c) => ({ id: c.location_id, name: c.location_name }))),
    [classes]
  );

  // Clamp to "all" when the selected location is no longer among the options
  // (e.g. its last class was removed) — otherwise the chips vanish while the
  // filter keeps hiding every row with no control to clear it.
  const effLocationFilter = locationOpts.some((o) => o.id === locationFilter)
    ? locationFilter
    : "";
  const shown = React.useMemo(
    () =>
      effLocationFilter
        ? classes.filter((c) => c.location_id === effLocationFilter)
        : classes,
    [classes, effLocationFilter]
  );

  // Today's weekday, in Singapore, read ONCE and passed in as a value. The
  // grouping helper cannot read a clock at all (domain/weekOrder.ts) — the same
  // shape lib/timeOfDay.ts forced after §7.7.
  const todayDow = dayOfWeekOf(todayInSg());
  const groups = React.useMemo(
    () => groupByWeekday(shown, (c) => c.day_of_week, todayDow),
    [shown, todayDow]
  );

  const loadClasses = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    const { data: coach } = await fetchCoach(session);

    if (!coach) {
      setLoading(false);
      return;
    }

    const { data } = await fetchCoachClasses(coach.id);

    setClasses(classesOf(data));

    setLoading(false);
  }, [session]);

  return {
    classes,
    loading,
    setLocationFilter,
    locationOpts,
    effLocationFilter,
    groups,
    loadClasses,
  };
}
