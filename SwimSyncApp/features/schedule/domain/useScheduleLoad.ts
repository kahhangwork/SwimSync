// The Schedule tab's spine: the load and the state it writes
// (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 3). `loadData` is moved VERBATIM from
// app/(coach)/schedule/index.tsx — its builders are dao calls now, its pure
// half is domain/scheduleIndex + domain/scheduleRows (Stage 2); nothing else
// changed.
//
// ⚠ `loadData` KEEPS ITS useCallback AND ITS DEPS, BYTE-IDENTICAL. The route's
// useFocusEffect is keyed on its identity (the ⚠ ONE EFFECT comment there), so
// the deps decide when the tab refetches.
//
// ⚠ THE ARGUMENTS ARE PLAIN VALUES FROM THE CALLING RENDER — exactly what the
// callback closed over when it lived on the route. No useRef "latest value",
// no useMemo on any of them, and NO clock read in this file: `todayDate` and
// `nowMins` come from useWeek.
import { useState, useCallback, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { backlogWindowStart } from "@/lib/lessonDates";
import {
  parseAssignments,
  assignmentsByLesson,
  rosteredDatesByClass,
} from "@/lib/coachRoster";
import {
  fetchCoach,
  fetchOwnedClasses,
  fetchRosterRows,
  fetchCoveredClasses,
  fetchShadowAssignments,
  fetchShadowedClasses,
  fetchWindowSessions,
  fetchTrialBookings,
  fetchMakeupBookings,
} from "../dao/schedule.repo";
import { fetchMarkableFloor, fetchCoveredOutSessions } from "../dao/schedule.rpc";
import type { WeekLesson, BacklogItem } from "../types";
import {
  coveredClassIdsOf,
  shadowClassIdsOf,
  coachClassesOf,
  sessionIndex,
  bookedIndex,
  isTruncated,
} from "./scheduleIndex";
import { buildSchedule, applyCoveredOut } from "./scheduleRows";

export function useScheduleLoad({
  weekOffset,
  todayDate,
  nowMins,
  weekStart,
  weekEnd,
}: {
  weekOffset: number;
  todayDate: string;
  nowMins: number;
  weekStart: string;
  weekEnd: string;
}) {
  const session = useAppStore((s) => s.session);

  /** FLOOR-scoped and week-INDEPENDENT. See the comment on loadData. */
  const [needsMarking, setNeedsMarking] = useState<BacklogItem[]>([]);
  const [weekLessons, setWeekLessons] = useState<WeekLesson[]>([]);
  const [floor, setFloor] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  // ⚠ THE LAST REQUEST TO *RESOLVE* IS NOT ALWAYS THE LAST ONE *ISSUED*.
  // `weekStart`/`weekEnd` are derived synchronously from `weekOffset`, so the
  // header and the date range repaint the instant an arrow is pressed while the
  // lessons arrive later. Press twice quickly and the first round can land
  // after the second, leaving last week's lessons under this week's heading.
  // Stamp each run and let only the newest write state.
  const loadToken = useRef(0);

  const loadData = useCallback(async () => {
    if (!session) return;
    const token = ++loadToken.current;
    const current = () => token === loadToken.current;
    setLoading(true);

    // Get coach record — and the business's marking floor alongside it. The
    // floor depends on nothing here, so it rides with a query already in flight
    // rather than adding a round trip in front of everything else.
    const [{ data: coach }, markableFloor] = await Promise.all([
      fetchCoach(session),
      fetchMarkableFloor(),
    ]);
    if (!current()) return;
    setFloor(markableFloor);

    if (!coach) {
      setNeedsMarking([]);
      setWeekLessons([]);
      setTruncated(false);
      setLoading(false);
      return;
    }

    // ── THE TWO RANGES, AND WHY THEY ARE UNIONED INTO ONE QUERY ──────────────
    // NEEDS MARKING is floor-scoped: [backlogFrom, today]. The week sections are
    // week-scoped: [weekStart, weekEnd]. One fetch covers both by spanning the
    // union, which is at most ~2 weeks wider than the backlog alone.
    const backlogFrom = backlogWindowStart(todayDate, null, markableFloor);
    const rangeStart = backlogFrom < weekStart ? backlogFrom : weekStart;
    const rangeEnd = todayDate > weekEnd ? todayDate : weekEnd;

    // ── TWO FETCHES, UNIONED IN JS — NOT ONE WIDENED FILTER ──────────────────
    // A lesson reaches this coach two ways now, and they have nothing in common
    // at the query layer:
    //
    //   (a) `classes.coach_id = me` — my own classes, every week they run.
    //   (b) `session_coaches.coach_id = me` — ONE lesson of somebody else's
    //       class that an admin rostered me onto as its SUBSTITUTE.
    //   (c) `class_shadow_coaches.coach_id = me`, active today — EVERY lesson of
    //       a class I am shadowing (20260812000200). The OPPOSITE shape to (b):
    //       no per-lesson rows exist at all, so the dates come from the class's
    //       own recurrence exactly as they do for (a).
    //
    // Widening (a) to "classes I am rostered on" would be wrong twice over: the
    // week card is built from the CLASS row and its enrolments, and a covered
    // class must contribute only the dates I was actually assigned — never its
    // ordinary weekday recurrence, which is a set of lessons that belong to
    // somebody else.
    const [classesRes, rosterRes] = await Promise.all([
      fetchOwnedClasses(coach),
      fetchRosterRows(coach, rangeStart, rangeEnd),
    ]);
    if (!current()) return;

    const ownedClasses = classesRes.data ?? [];
    const ownedClassIds = new Set(ownedClasses.map((c: any) => c.id as string));
    const assignments = parseAssignments(rosterRes.data);
    const assignmentByLesson = assignmentsByLesson(assignments);
    const rosteredDates = rosteredDatesByClass(assignments);

    // The classes I am covering INTO. Fetched with the same columns, and
    // deliberately WITHOUT `.eq("is_active", true)`: a roster row names one
    // real lesson that already has a `lesson_sessions` row, so the billing
    // engine expects attendance for it whatever later happened to the class.
    // Hiding it because the class was since deactivated strands a straggler
    // nobody can clear, and the month blocks with no override (§8i).
    const coveredClassIds = coveredClassIdsOf(rosteredDates, ownedClassIds);
    const coveredRes =
      coveredClassIds.length > 0
        ? await fetchCoveredClasses(coveredClassIds)
        : { data: [] as any[] };
    if (!current()) return;

    // ── (c) THE CLASSES I SHADOW ──────────────────────────────────────────
    // ⚠ ACTIVE TODAY, not "on the lesson's date". Visibility and pay ask
    // different questions of the same dated record (20260812000200 §4): once an
    // assignment ENDS the class leaves my app entirely, even though I am still
    // paid for the lessons inside its range. Filtering by the range here would
    // keep showing an ex-shadow a class they no longer have anything to do with.
    const { data: shadowRows } = await fetchShadowAssignments(coach, todayDate);
    if (!current()) return;

    const shadowClassIds = shadowClassIdsOf(shadowRows, ownedClassIds, coveredClassIds);

    const shadowRes =
      shadowClassIds.length > 0
        ? await fetchShadowedClasses(shadowClassIds)
        : { data: [] as any[] };
    if (!current()) return;

    const shadowedClassIds = new Set(shadowClassIds);

    const coachClasses = coachClassesOf(ownedClasses, coveredRes, shadowRes, shadowedClassIds);
    const classIds = coachClasses.map((c) => c.cls.id as string);

    const sessionsRes = classIds.length > 0
      ? await fetchWindowSessions(classIds, rangeStart, rangeEnd)
      : { data: [] as any[] };
    const windowSessions = sessionsRes.data ?? [];

    const { sessionByClassDate, sessionDatesByClass } = sessionIndex(windowSessions);

    // Trial AND make-up bookings. A booked child is expected at ONE lesson and
    // is not enrolled here, so without these an unmarked booking never reaches
    // the coach — while the invoice engine refuses to close the month over it.
    // The two must agree (§7.18). Both kinds satisfy the same "expected at one
    // lesson" contract, so they merge into one map, exactly as the engine does.
    //
    // ⚠ BOUND THESE TO [rangeStart, rangeEnd] — THE SAME UNION THE SESSIONS
    // QUERY USES — AND NEVER TO [weekStart, weekEnd]. `bookedByClassDate` feeds
    // expectedStudentsOn() for EVERY date in the floor-scoped backlog, so
    // narrowing it to the visible week makes a lesson whose only attendee was a
    // trial vanish from NEEDS MARKING while the engine still blocks the month
    // over it. That is §7.18 reopened through the door of a performance fix.
    //
    // (These queries previously had no class filter and no date filter at all,
    // so they returned every non-cancelled booking the tenant had ever made and
    // would have hit the silent max_rows ceiling long before lesson_sessions.)
    const [bookingsRes, makeupsRes] = await Promise.all([
      classIds.length > 0
        ? fetchTrialBookings(classIds, rangeStart, rangeEnd)
        : Promise.resolve({ data: [] as any[] }),
      classIds.length > 0
        ? fetchMakeupBookings(classIds, rangeStart, rangeEnd)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const bookingRows = bookingsRes.data ?? [];
    const makeupRows = makeupsRes.data ?? [];

    // A result that exactly fills its limit is indistinguishable from a
    // truncated one, so treat it as truncated and SAY SO on screen rather than
    // rendering a quietly short list that reads as "you are up to date".
    if (!current()) return;
    setTruncated(
      isTruncated({ windowSessions, bookingRows, makeupRows, rosterRes })
    );

    const bookedByClassDate = bookedIndex(bookingRows, makeupRows);

    const { lessons, backlogItems, probeIds } = buildSchedule({
      coachClasses,
      sessionByClassDate,
      sessionDatesByClass,
      bookedByClassDate,
      rosteredDates,
      assignmentByLesson,
      weekStart,
      weekEnd,
      backlogFrom,
      todayDate,
      nowMins,
    });

    // ── AND THE ONE QUESTION ONLY THE DATABASE CAN ANSWER ────────────────────
    // Everything above knows my own roster rows. It cannot know that somebody
    // ELSE was rostered onto a lesson of MY class: `session_coaches_select`
    // shows a coach only their own rows, deliberately. So ask the definer-rights
    // gate — the same predicate `attendance_write` uses — about the lessons
    // where the answer can still change what is on screen.
    //
    // ⚠ THE PROBE SET IS BOUNDED BY CONSTRUCTION, AND THAT STILL MATTERS even
    // though it is now ONE round trip for the whole array
    // (`sessions_i_am_main_on`, 20260812000100): the answer is subtracted from
    // what was asked, so an over-generous probe set is what would eventually
    // meet PostgREST's truncating `max-rows`. Only lessons of MY OWN classes,
    // only ones that already HAVE a session row (an assignment creates it, so a
    // lesson without one cannot be covered), and only ones still unfinished. A
    // month of marked history asks nothing.
    const coveredOut = await fetchCoveredOutSessions(probeIds);
    if (!current()) return;

    const { ownBacklog, weekCards } = applyCoveredOut(backlogItems, lessons, coveredOut);
    setNeedsMarking(ownBacklog);
    setWeekLessons(weekCards);

    // ⚠ NO INVOICE COUNT HERE, DELIBERATELY. This screen used to show an
    // "Outstanding" tile counting unpaid invoices across every parent the coach
    // serves — a number with no date bound, sitting between "Classes Today" and
    // "Students Today" where it read as a fact about today's lessons. It is
    // neither today-scoped nor lesson-shaped, and since payment collection
    // shipped (PRD §7.21) chasing an invoice is an admin-panel job with the
    // reference, the QR and the WhatsApp queue behind it. Removed 2026-08-02
    // along with the coach's invoice list; do not re-add a count here.
    setLoading(false);
    // ⚠ `weekOffset` IS LOAD-BEARING IN THESE DEPS. Without it the focus
    // refetch after marking a lesson fetches the CURRENT week's range while the
    // header still names a past one — §7.64's screen family, and a stale
    // closure there cost a production billing bug.
    // `weekStart`/`weekEnd` are NOT in the list: they are pure functions of
    // `todayDate` and `weekOffset`, so adding them only widens the array
    // without changing when it fires.
  }, [session, todayDate, weekOffset]);

  return {
    session,
    needsMarking,
    weekLessons,
    floor,
    truncated,
    loading,
    loadData,
  };
}
