// The roster screen's SPINE (COACH_ROSTER_REFACTOR_PLAN.md, Stage 3): its nine
// loaded values, the duplicate-name memo, `todayDate`, and `loadData` — moved
// verbatim from app/(coach)/classes/[id]/roster.tsx, with every query now a
// dao/ call and every mapping a pure function in rosterRows.ts.
//
// ⚠ `loadData` is returned UNWRAPPED, as the `useCallback(…, [id, todayDate])`
// value itself. The route passes it to useFocusEffect, which re-runs whenever
// its identity changes — a hook that returned `() => loadData()` or changed the
// deps would refetch on every render and pin the screen on its spinner. Never
// wrap it, never touch the deps.
//
// ⚠ TWO CLOCKS, on purpose: `todayDate` (read at render, a loadData dep) bounds
// the queries and the window; `today` is read AFTER the bookings await and
// filters upcoming guests. They differ only across midnight. Keep both.
//
// ⚠ No `if (!id) return`: an undefined `id` has always run one query and hit
// the `!cls` early return, which leaves `loading` true->false. A guard would
// skip `setLoading(true)` and change that.
import React, { useState, useCallback } from "react";
import {
  todayInSg,
  backlogWindowStart,
  type DayOfWeek,
} from "@/lib/lessonDates";
import { type EnrolmentSpan } from "@/lib/attendanceCompleteness";
import type { Student, Session, ClassInfo, Guest, Extra } from "@/features/roster/types";
import {
  toClassInfo,
  toActiveStudents,
  toUpcomingExtras,
  toEnrolmentSpans,
  upcomingBookings,
  guestIdsOf,
  nameByIdOf,
  namedGuests,
  bookedByDateOf,
  buildSessions,
  duplicateNameKeys,
} from "@/features/roster/domain/rosterRows";
import {
  loadClass,
  loadPastSessions,
  loadUpcomingExtras,
  loadTrialBookings,
  loadMakeupBookings,
  loadGuestNames,
} from "@/features/roster/dao/roster.repo";
import { fetchMarkableFloor } from "@/features/roster/dao/roster.rpc";

export function useRosterData(id: string) {
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  // ⚠ Guests, not members. A booked child is expected at ONE lesson and is not
  // enrolled, so they never appear in the roster below — and the coach had no
  // way to know a trial was coming until the child turned up at the poolside.
  // The counts already accounted for them; only the coach didn't.
  const [upcomingTrials, setUpcomingTrials] = useState<Guest[]>([]);
  // Make-up guests: enrolled children from ANOTHER same-category class,
  // booked into one lesson here. Same shape and same stakes as trials.
  const [upcomingMakeups, setUpcomingMakeups] = useState<Guest[]>([]);
  // Lessons the admin has SCHEDULED off the class's usual weekday — a makeup,
  // a holiday shift. The session row exists ahead of time (unlike an ordinary
  // lesson, which is created lazily when attendance is saved), and the sessions
  // query below is bounded to today, so without this the coach would get no
  // warning at all: the extra lesson would simply appear in their backlog on
  // the day, unexplained.
  const [upcomingExtras, setUpcomingExtras] = useState<Extra[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  // DATE ONLY. This used to carry the resolved `sessionId` and pass it to the
  // attendance screen in the URL; that screen no longer accepts one (it resolves
  // the session from (class_id, date) itself), so keeping the field here would
  // be a dead value whose name invites putting the param back.
  const [markTarget, setMarkTarget] = useState<{ date: string } | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const duplicateNames = React.useMemo(() => duplicateNameKeys(students), [students]);

  const todayDate = todayInSg();

  const loadData = useCallback(async () => {
    setLoading(true);

    // Load class info + enrolled students
    const { data: cls } = await loadClass(id);

    if (!cls) {
      setLoading(false);
      return;
    }

    setClassInfo(toClassInfo(cls));

    const activeStudents: Student[] = toActiveStudents(cls);

    setStudents(activeStudents);

    // The business's marking floor. STARTED here and awaited far below, so the
    // round trip overlaps the two session queries instead of being appended to
    // them. Safe to leave in flight: fetchMarkableFloor resolves on every path
    // and never rejects, which is what stops a deferred await becoming an
    // unhandled rejection.
    const markableFloorPromise = fetchMarkableFloor();

    // Load all past sessions for this class (up to today)
    const { data: sessionData } = await loadPastSessions(id, todayDate);

    // Extra lessons the admin has scheduled AHEAD — a separate query on
    // purpose; the reason is on loadUpcomingExtras in dao/roster.repo.ts.
    const { data: extraData } = await loadUpcomingExtras(id, todayDate);

    setUpcomingExtras(toUpcomingExtras(extraData));

    const enrolmentSpans: EnrolmentSpan[] = toEnrolmentSpans(cls);

    // The marking floor, awaited HERE rather than further down because the
    // booking queries below are bounded by it. It has been in flight since the
    // top of this function, so this await costs nothing.
    //
    // ⚠ FLOOR ONLY — `null` for the enrolment date, NOT this class's earliest
    // enrolment (§7.97, and the Schedule tab does the same at
    // `schedule/index.tsx:328`). A class that trialled a child on 15 Jul but
    // took its first enrolment on 1 Aug would otherwise lose that unmarked
    // trial from this screen entirely, while generate-invoices unions booking
    // dates with no enrolment floor at all and still blocks the month over it.
    // Weekday dates from before anyone enrolled are still suppressed, by the
    // `expectedHere.length === 0` skip below — which is the same division of
    // labour the Schedule tab uses.
    const markableFloor = await markableFloorPromise;
    const winStart = backlogWindowStart(todayDate, null, markableFloor);

    // Trial AND make-up bookings for this class. A booked child is expected at
    // ONE lesson and is not enrolled here, so the counts below would read
    // "3 of 3 marked" while the invoice engine refuses to close the month over
    // an unmarked fourth.
    //
    // ⚠ BOUNDED BELOW, AND DELIBERATELY NOT ABOVE. These rows feed two things:
    // the backlog list (past, from winStart) and the *upcoming guests* panel
    // (future), so an upper bound would empty the panel. The lower bound is the
    // real fix — unbounded, this fetched every booking the class has ever held,
    // which is both the §7.70 max_rows exposure the Schedule tab already closed
    // on these same two tables and, now that the date list below is derived
    // FROM booking dates, a route to rendering a Mark tile for a lesson below
    // the floor that can only ever answer "that lesson is closed".
    const [{ data: bookingRows }, { data: makeupBookingRows }] =
      await Promise.all([
        loadTrialBookings(id, winStart),
        loadMakeupBookings(id, winStart),
      ]);

    // The same rows, read the other way: who is coming, and when.
    const today = todayInSg();
    const upcoming = upcomingBookings(bookingRows, today);
    const upcomingMk = upcomingBookings(makeupBookingRows, today);
    const guestIds = guestIdsOf(upcoming, upcomingMk);
    if (guestIds.length > 0) {
      const { data: guestRows } = await loadGuestNames(guestIds);
      const nameById = nameByIdOf(guestRows);
      setUpcomingTrials(namedGuests(upcoming, nameById, "A trial student"));
      setUpcomingMakeups(namedGuests(upcomingMk, nameById, "A make-up student"));
    } else {
      setUpcomingTrials([]);
      setUpcomingMakeups([]);
    }

    const bookedByDate = bookedByDateOf(bookingRows, makeupBookingRows);

    const { rows, target } = buildSessions({
      sessionData,
      enrolmentSpans,
      bookedByDate,
      dayOfWeek: cls.day_of_week as DayOfWeek,
      winStart,
      todayDate,
    });

    setMarkTarget(target);
    setWindowStart(winStart);

    setSessions(rows);
    setLoading(false);
  }, [id, todayDate]);

  return {
    classInfo,
    students,
    upcomingTrials,
    upcomingMakeups,
    upcomingExtras,
    sessions,
    markTarget,
    windowStart,
    loading,
    duplicateNames,
    todayDate,
    loadData,
  };
}
