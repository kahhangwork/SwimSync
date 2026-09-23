// The parent Attendance tab's state and its two loads (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). Moved VERBATIM from app/(parent)/attendance/index.tsx — state, the
// stale-response ticket (loadIdRef), loadChildren and loadAttendance with their
// deps byte-identical ([session], [selectedChildId]); builders are dao calls, every
// row mapping is domain/attendanceFormat, the projection domain/upcomingLessons
// (moved from lib/, this screen was its one importer).
//
// ⚠ THE TWO FOCUS EFFECTS STAY ON THE ROUTE, in their original order (children,
// then attendance), keyed on these callbacks' identities (plan ⚠ R4). The
// ⚠ holiday-read fail-safe and every `fresh()` guard are unchanged.
import { useState, useCallback, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { todayInSg } from "@/lib/lessonDates";
import { addDays } from "@/lib/scheduleWeek";
import {
  fetchParentId,
  fetchChildLinks,
  fetchAttendance,
  fetchActiveEnrolments,
  fetchUpcomingHolidays,
  fetchUpcomingMakeups,
  fetchUpcomingExtras,
  fetchUpcomingCancelled,
} from "../dao/parentAttendance.repo";
import type { AttendanceRecord, Child, FilterOption } from "../types";
import {
  matchesFilter,
  childrenOf,
  recordsOf,
  activeClassesOf,
  hasExpectedLessonOf,
  enrolmentInputsOf,
  makeupInputsOf,
  extraInputsOf,
  cancelledInputsOf,
} from "./attendanceFormat";
import {
  computeUpcomingLessons,
  UPCOMING_HORIZON_DAYS,
  type UpcomingLesson,
} from "./upcomingLessons";

export function useParentAttendance() {
  const session = useAppStore((s) => s.session);
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filter, setFilter] = useState<FilterOption>("All");
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  // Whether any lesson should have happened since this child joined — lets us
  // tell "no lessons have taken place yet" (child just joined) apart from
  // "lessons happened but the coach hasn't marked them" (waiting on the coach).
  const [hasExpectedLesson, setHasExpectedLesson] = useState(false);
  // Lessons scheduled in the next ~4 weeks (derived, not stored). Holidays removed.
  const [upcoming, setUpcoming] = useState<UpcomingLesson[]>([]);
  // Guards against a stale response winning: each loadAttendance run takes a
  // ticket; a run only commits its state if its ticket is still the latest.
  // Without this, switching child mid-load could paint child A's make-ups under
  // child B (a wrong "Make-up" badge is actively misleading).
  const loadIdRef = useRef(0);

  // Load the parent's children once on focus
  const loadChildren = useCallback(async () => {
    if (!session) return;
    setLoadingChildren(true);

    const { data: parent } = await fetchParentId(session);

    if (!parent) {
      setLoadingChildren(false);
      return;
    }

    const { data: links } = await fetchChildLinks(parent.id);

    const childList: Child[] = childrenOf(links);

    setChildren(childList);
    // Functional update, NOT a `!selectedChildId` closure read: this callback's
    // deps are [session], so the captured selectedChildId is stale on every
    // refocus and the guard would keep resetting the selection to the first
    // child (and re-trigger the heavier loadAttendance). `prev ?? …` only
    // defaults when nothing is selected yet.
    if (childList.length > 0) {
      setSelectedChildId((prev) => prev ?? childList[0].id);
    }
    setLoadingChildren(false);
  }, [session]);

  // Load attendance whenever selected child changes
  const loadAttendance = useCallback(async () => {
    if (!selectedChildId) return;
    const myLoadId = ++loadIdRef.current;
    const fresh = () => myLoadId === loadIdRef.current;
    setLoadingRecords(true);

    const { data } = await fetchAttendance(selectedChildId);

    const mapped: AttendanceRecord[] = recordsOf(data);

    if (!fresh()) return; // a newer child selection is in flight
    setRecords(mapped);

    // Has any lesson fallen due since this child joined? Derived from each
    // class's weekday + that enrolment's own date (the same read-time logic the
    // coach screens use), so an empty history can distinguish "no lessons yet"
    // from "unmarked".
    //
    // ⚠ THIS WAS `.maybeSingle()` UNTIL WAVE 2, AND IT FAILED QUIETLY. maybeSingle
    // ERRORS on more than one row; the error was discarded, `enr` came back null,
    // and a child in two classes was told "no lessons yet" — the emptiest
    // possible answer, on the screen whose whole job is telling the two apart.
    // Now every active enrolment is read and ANY of them having had a lesson is
    // enough, which is what the question actually means.
    const { data: enrolments } = await fetchActiveEnrolments(selectedChildId);

    const today = todayInSg();
    const horizon = addDays(today, UPCOMING_HORIZON_DAYS);
    const activeClasses = activeClassesOf(enrolments);

    if (!fresh()) return;
    setHasExpectedLesson(hasExpectedLessonOf(activeClasses, today));

    // Upcoming lessons, from three sources merged in computeUpcomingLessons():
    //   • the weekly projection off each active enrolment's weekday, minus this
    //     tenant's public holidays (RLS returns only the parent's tenant);
    //   • booked make-ups — the child guesting one lesson in another (HOST) class;
    //   • admin off-schedule extra lessons in the child's own class.
    // Make-ups and extras are EXPLICIT rows, so they win any (class, date)
    // collision with the projection (see the helper's precedence note).
    const activeClassIds = activeClasses
      .map(({ cls }) => cls?.id as string | undefined)
      .filter((id): id is string => !!id);

    const [
      { data: holidayRows, error: holidayErr },
      { data: makeupRows, error: makeupErr },
      { data: extraRows, error: extraErr },
      { data: cancelledRows, error: cancelledErr },
    ] = await Promise.all([
      fetchUpcomingHolidays(today, horizon),
      fetchUpcomingMakeups(selectedChildId, today, horizon),
      // Extra lessons that are still ON — the cancelled_at filter's reason is on
      // dao/parentAttendance.repo fetchUpcomingExtras.
      activeClassIds.length
        ? fetchUpcomingExtras(activeClassIds, today, horizon)
        : Promise.resolve({ data: [] as any[], error: null }),
      // Lessons the admin cancelled in advance, in any of the child's classes —
      // shown struck "Cancelled" so the parent sees WHY there is no lesson.
      activeClassIds.length
        ? fetchUpcomingCancelled(activeClassIds, today, horizon)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (!fresh()) return;

    if (makeupErr) console.warn("upcoming: make-up read failed", makeupErr.message);
    if (extraErr) console.warn("upcoming: extra-lesson read failed", extraErr.message);
    if (cancelledErr) console.warn("upcoming: cancelled-lesson read failed", cancelledErr.message);

    // A failed HOLIDAY read is fail-safe, not fail-open: if we cannot know which
    // days the pool is closed, projecting weekly lessons could tell a parent to
    // turn up on a holiday (the RISK 4 the helper exists to prevent). So on a
    // holiday-read error, show nothing rather than a possibly-wrong list.
    if (holidayErr) {
      console.warn("upcoming: holiday read failed", holidayErr.message);
      setUpcoming([]);
      setLoadingRecords(false);
      return;
    }

    const holidays = new Set(
      (holidayRows ?? []).map((h: any) => h.holiday_date as string)
    );

    const enrolmentInputs = enrolmentInputsOf(activeClasses);

    const makeupInputs = makeupInputsOf(makeupRows);

    const extraInputs = extraInputsOf(extraRows);

    const cancelledInputs = cancelledInputsOf(cancelledRows);

    setUpcoming(
      computeUpcomingLessons(
        enrolmentInputs,
        today,
        holidays,
        makeupInputs,
        extraInputs,
        cancelledInputs
      )
    );

    setLoadingRecords(false);
  }, [selectedChildId]);

  const selectedChild = children.find((c) => c.id === selectedChildId) ?? null;
  const filtered = records.filter((r) => matchesFilter(r.status, filter));

  return {
    children,
    selectedChildId,
    setSelectedChildId,
    records,
    filter,
    setFilter,
    loadingChildren,
    loadingRecords,
    hasExpectedLesson,
    upcoming,
    loadChildren,
    loadAttendance,
    selectedChild,
    filtered,
  };
}
