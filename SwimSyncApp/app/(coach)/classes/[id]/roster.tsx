import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import {
  todayInSg,
  backlogWindowStart,
  toSgDate,
  formatSgDate,
  ageFromDob,
  type DayOfWeek,
} from "@/lib/lessonDates";
import { lessonDatesInRange } from "@/lib/scheduleWeek";
import { fetchMarkableFloor } from "@/lib/markableFloor";
import {
  type EnrolmentSpan,
  expectedStudentsOn,
} from "@/lib/attendanceCompleteness";
import {
  lessonProgress,
  summariseStatuses,
  formatSummary,
  progressLabel,
  isFinished,
  type LessonProgress,
  type DbStatus,
} from "@/lib/attendanceSummary";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";
import { confirmAction } from "@/lib/confirm";
import { useAppStore } from "@/store/useAppStore";
import { removeFromClass } from "@/lib/studentStatus";

type Student = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  level_label: string | null;
  level_note: string | null;
  level_skills: string[];
};

type Session = {
  id: string | null; // null = the lesson should have happened but was never marked
  session_date: string;
  progress: LessonProgress;
  /** "3 present · 2 cancelled (rain)", or "" when nothing is recorded. */
  summary: string;
  /** Cancelled in advance by the admin (cancel_lesson) — nothing to mark. */
  cancelled?: boolean;
  cancelReason?: string | null;
};

type ClassInfo = {
  title: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  location_name: string;
};

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function formatDate(dateStr: string): string {
  return formatSgDate(dateStr, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function ClassRosterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  // ⚠ Guests, not members. A booked child is expected at ONE lesson and is not
  // enrolled, so they never appear in the roster below — and the coach had no
  // way to know a trial was coming until the child turned up at the poolside.
  // The counts already accounted for them; only the coach didn't.
  const [upcomingTrials, setUpcomingTrials] = useState<
    { id: string; full_name: string; session_date: string }[]
  >([]);
  // Make-up guests: enrolled children from ANOTHER same-category class,
  // booked into one lesson here. Same shape and same stakes as trials.
  const [upcomingMakeups, setUpcomingMakeups] = useState<
    { id: string; full_name: string; session_date: string }[]
  >([]);
  // Lessons the admin has SCHEDULED off the class's usual weekday — a makeup,
  // a holiday shift. The session row exists ahead of time (unlike an ordinary
  // lesson, which is created lazily when attendance is saved), and the sessions
  // query below is bounded to today, so without this the coach would get no
  // warning at all: the extra lesson would simply appear in their backlog on
  // the day, unexplained.
  const [upcomingExtras, setUpcomingExtras] = useState<
    { id: string; session_date: string; reason: string }[]
  >([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  // DATE ONLY. This used to carry the resolved `sessionId` and pass it to the
  // attendance screen in the URL; that screen no longer accepts one (it resolves
  // the session from (class_id, date) itself), so keeping the field here would
  // be a dead value whose name invites putting the param back.
  const [markTarget, setMarkTarget] = useState<{ date: string } | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Which student's level curriculum is expanded — poolside reference.
  const [openLevelFor, setOpenLevelFor] = useState<string | null>(null);

  // Names shared by more than one child on THIS roster — the two-Ethan-Tans
  // case. Compared on the same normalised form as the database's identity
  // index (trimmed + lowercased) so the screen and the constraint agree on
  // what "the same name" means.
  const duplicateNames = React.useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const s of students) {
      const key = s.full_name.trim().toLowerCase();
      if (seen.has(key)) dupes.add(key);
      seen.add(key);
    }
    return dupes;
  }, [students]);
  const showToast = useAppStore((s) => s.showToast);

  const todayDate = todayInSg();

  const loadData = useCallback(async () => {
    setLoading(true);

    // Load class info + enrolled students
    const { data: cls } = await supabase
      .from("classes")
      .select(`
        title,
        day_of_week,
        start_time,
        end_time,
        locations(name),
        student_class_enrolments(
          is_active,
          enrolled_at,
          unenrolled_at,
          student_id,
          students(id, full_name, date_of_birth, tenant_levels(label, note, tenant_level_skills(label, sort_order)))
        )
      `)
      .eq("id", id)
      .single();

    if (!cls) {
      setLoading(false);
      return;
    }

    setClassInfo({
      title: cls.title,
      day_of_week: cls.day_of_week,
      start_time: cls.start_time,
      end_time: cls.end_time,
      // PostgREST returns a to-one embed as an object; the generated types widen
      // it to an array, so cast rather than index.
      location_name: (cls.locations as any)?.name ?? "—",
    });

    const activeStudents: Student[] = (cls.student_class_enrolments ?? [])
      .filter((e: any) => e.is_active)
      // NOTE (§7.28): date_of_birth is read off `e.students`, NOT off the
      // enrolment — both tables are in this nested select and the result is
      // `any`, so the wrong nesting level would typecheck and render every
      // child ageless.
      .map((e: any) => ({
        id: e.students.id,
        full_name: e.students.full_name,
        date_of_birth: e.students.date_of_birth,
        // Off the JOINED tenant_levels row (§7.28).
        level_label: e.students.tenant_levels?.label ?? null,
        level_note: e.students.tenant_levels?.note ?? null,
        // Sorted here: PostgREST cannot order an embedded resource, so doing
        // it in the query would silently do nothing.
        level_skills: [...(e.students.tenant_levels?.tenant_level_skills ?? [])]
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((sk: any) => sk.label),
      }));

    setStudents(activeStudents);

    // The business's marking floor. STARTED here and awaited far below, so the
    // round trip overlaps the two session queries instead of being appended to
    // them. Safe to leave in flight: fetchMarkableFloor resolves on every path
    // and never rejects, which is what stops a deferred await becoming an
    // unhandled rejection.
    const markableFloorPromise = fetchMarkableFloor();

    // Load all past sessions for this class (up to today)
    const { data: sessionData } = await supabase
      .from("lesson_sessions")
      .select(`
        id,
        session_date,
        cancelled_at,
        cancellation_reason,
        attendance(id, student_id, status)
      `)
      .eq("class_id", id)
      .lte("session_date", todayDate)
      .order("session_date", { ascending: false });

    // Extra lessons the admin has scheduled AHEAD. Deliberately a separate
    // query rather than widening the one above: everything below treats
    // `sessionData` as lessons that have already happened, and a future row in
    // it would be counted as an unmarked backlog item the coach cannot yet act
    // on.
    const { data: extraData } = await supabase
      .from("lesson_sessions")
      .select("id, session_date, off_schedule_reason")
      .eq("class_id", id)
      .gt("session_date", todayDate)
      .not("off_schedule_reason", "is", null)
      .order("session_date", { ascending: true });

    setUpcomingExtras(
      (extraData ?? []).map((s: any) => ({
        id: s.id as string,
        session_date: s.session_date as string,
        reason: s.off_schedule_reason as string,
      }))
    );

    const totalStudents = activeStudents.length;

    // Who was expected at a lesson is a question about THAT LESSON'S date, so
    // an enrolment is a span, not a flag. Built from every enrolment row (not
    // just the active ones): a child who has since left was still expected at
    // the lessons they were enrolled for, and their marked rows must keep
    // counting. See EnrolmentSpan in lib/attendanceCompleteness.ts.
    const enrolmentSpans: EnrolmentSpan[] = (
      cls.student_class_enrolments ?? []
    ).map((e: any) => ({
      studentId: (e.student_id ?? e.students?.id) as string,
      from: toSgDate(e.enrolled_at),
      until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
    }));

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
        supabase
          .from("trial_bookings")
          .select("student_id, session_date")
          .eq("class_id", id)
          .is("cancelled_at", null)
          .gte("session_date", winStart),
        supabase
          .from("makeup_bookings")
          .select("student_id, session_date")
          .eq("class_id", id)
          .is("cancelled_at", null)
          .gte("session_date", winStart),
      ]);

    // The same rows, read the other way: who is coming, and when.
    const today = todayInSg();
    const upcoming = (bookingRows ?? [])
      .filter((b: any) => (b.session_date as string) >= today)
      .sort((a: any, b: any) =>
        (a.session_date as string).localeCompare(b.session_date as string)
      );
    const upcomingMk = (makeupBookingRows ?? [])
      .filter((b: any) => (b.session_date as string) >= today)
      .sort((a: any, b: any) =>
        (a.session_date as string).localeCompare(b.session_date as string)
      );
    const guestIds = [
      ...new Set([
        ...upcoming.map((b: any) => b.student_id),
        ...upcomingMk.map((b: any) => b.student_id),
      ]),
    ];
    if (guestIds.length > 0) {
      const { data: guestRows } = await supabase
        .from("students")
        .select("id, full_name")
        .in("id", guestIds);
      const nameById = new Map(
        (guestRows ?? []).map((s: any) => [s.id as string, s.full_name as string])
      );
      setUpcomingTrials(
        upcoming.map((b: any) => ({
          id: b.student_id as string,
          full_name: nameById.get(b.student_id as string) ?? "A trial student",
          session_date: b.session_date as string,
        }))
      );
      setUpcomingMakeups(
        upcomingMk.map((b: any) => ({
          id: b.student_id as string,
          full_name: nameById.get(b.student_id as string) ?? "A make-up student",
          session_date: b.session_date as string,
        }))
      );
    } else {
      setUpcomingTrials([]);
      setUpcomingMakeups([]);
    }

    // One merged map: both kinds of booking mean "expected at this lesson",
    // which is the contract expectedStudentsOn already has.
    const bookedByDate = new Map<string, string[]>();
    for (const b of [...(bookingRows ?? []), ...(makeupBookingRows ?? [])]) {
      const list = bookedByDate.get(b.session_date as string) ?? [];
      list.push(b.student_id as string);
      bookedByDate.set(b.session_date as string, list);
    }

    const rows: Session[] = (sessionData ?? []).map((s: any) => {
      const markedIds = new Set<string>(
        (s.attendance ?? []).map((a: any) => a.student_id)
      );
      // Enrolled students PLUS anyone booked for a trial that day — the shared
      // rule, so this screen and the engine count the same people. A lesson
      // the admin CANCELLED in advance expects nobody enrolled (the engine's
      // `unmarkedOn` makes the same substitution) — its bookings still count.
      const cancelled = s.cancelled_at != null;
      const expectedHere = cancelled
        ? expectedStudentsOn(s.session_date, [], bookedByDate)
        : expectedStudentsOn(s.session_date, enrolmentSpans, bookedByDate);
      return {
        id: s.id,
        session_date: s.session_date,
        cancelled,
        cancelReason: (s.cancellation_reason as string | null) ?? null,
        // Every past lesson has ended by definition — this list is bounded to
        // `<= todayDate` — so `upcoming` is unreachable here.
        progress: lessonProgress(expectedHere, markedIds, { hasEnded: true }),
        summary: formatSummary(
          summariseStatuses(
            expectedHere,
            new Map<string, DbStatus>(
              (s.attendance ?? []).map((a: any) => [a.student_id, a.status])
            )
          )
        ),
      };
    });

    // Merge in lessons that should have happened but were never marked — those
    // have no session row, so querying lesson_sessions alone renders nothing and
    // the screen would imply the class is fully up to date.
    //
    // The window floor is max(the BUSINESS'S marking floor, earliest enrolment):
    // the coach can mark back to there but no further — older lessons sit behind
    // a generated invoice and need a credit note, not a late mark. The same
    // window bounds the "Mark Attendance" target below.
    //
    // That floor is NOT "the start of last month" any more. Since 20260806000200
    // it follows billing_periods per business, so a month that was never sealed
    // stays markable after the calendar has rolled past it — which is what stops
    // a late-billed month from stranding a lesson nobody may record. A failed
    // fetch returns null and falls back to the old calendar rule.
    let target: { date: string } | null = null;

    // ⚠ NOT GATED ON `activeStudentIds.length > 0` — THAT GATE HID A LESSON
    // THE ENGINE BLOCKS ON. Until 20260810 both the synthesised rows and the
    // Mark Attendance target lived inside `if (activeStudentIds.length > 0)`,
    // so a class with no active enrolment rendered no lessons and no button —
    // even on a date where a trial or make-up guest was booked and expected.
    // The Schedule tab disagreed, listing that same lesson under NEEDS MARKING
    // with a Mark button, because it derives who is expected from
    // `expectedStudentsOn()` rather than from a head-count. Two coach surfaces
    // answering "is there a lesson here?" differently is the §7.18 shape, and
    // the seed's default state (one class, zero enrolments) sat on the wrong
    // side of it.
    //
    // ONE derivation of who was expected, shared with the Schedule tab and the
    // engine: `lessonDatesInRange` unions weekday dates, booking dates and
    // recorded session dates within the window, and `expectedStudentsOn` then
    // decides whether anyone was actually due. Do not re-inline either — §7.18
    // is four hand-written copies of this union causing a live underbill.
    // Built ONCE. `sessionData` has no lower bound (every past session this
    // class has ever held), and the loop below runs over every date in the
    // window, so a `.find()` per date is O(dates x sessions) on every open.
    const sessionIdByDate = new Map<string, string>(
      (sessionData ?? []).map((s: any) => [s.session_date as string, s.id as string])
    );
    // Dates the admin cancelled in advance: nobody enrolled is due, so such a
    // date must neither be synthesised as unmarked nor become the Mark target.
    const cancelledDates = new Set<string>(
      (sessionData ?? [])
        .filter((s: any) => s.cancelled_at != null)
        .map((s: any) => s.session_date as string)
    );
    const sessionDates = [...sessionIdByDate.keys()];
    const seen = new Set(rows.map((r) => r.session_date));

    for (const date of lessonDatesInRange(
      cls.day_of_week as DayOfWeek,
      winStart,
      todayDate,
      bookedByDate.keys(),
      sessionDates
    )) {
      // Nobody due here. This is what suppresses weekday dates from before the
      // class had any enrolments — the job the per-class enrolment floor used
      // to do, moved to where it can distinguish "no students yet" from "a
      // guest is booked". A guest-only date survives it; an empty one does not.
      const expectedHere = cancelledDates.has(date)
        ? expectedStudentsOn(date, [], bookedByDate)
        : expectedStudentsOn(date, enrolmentSpans, bookedByDate);
      if (expectedHere.length === 0) continue;

      // Primary action targets the most recent lesson anyone was due at.
      // `lessonDatesInRange` returns ascending, so the last write wins — and
      // because this now runs over the FILTERED list, the button can no longer
      // point at a weekday date with nobody on it while a guest's real lesson
      // goes untargeted.
      target = { date };

      if (seen.has(date)) continue;
      rows.push({
        id: null,
        session_date: date,
        // Span-derived, like the rows above, rather than the class's CURRENT
        // head-count. A synthesised row used `totalStudents`, so a lesson from
        // before a child joined showed them in its denominator — the §8.15
        // mid-month-joiner mistake, surviving on this one code path.
        progress: lessonProgress(expectedHere, undefined, { hasEnded: true }),
        summary: "",
      });
    }

    setMarkTarget(target);
    setWindowStart(winStart);

    // Descending. Sessions outside the expected window are kept — never hide
    // real data; the window only bounds which dates get synthesised.
    rows.sort((a, b) => b.session_date.localeCompare(a.session_date));

    setSessions(rows);
    setLoading(false);
  }, [id, todayDate]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );


  // Removing a student closes their enrolment; it never deletes anything.
  // Their past attendance still bills (the invoice engine reads attendance
  // rows, not current enrolment), and they drop out of the completeness check
  // so a child who has stopped coming can no longer block invoicing.
  // confirmAction, not Alert.alert — Alert is a no-op on the web build.
  const handleRemove = (student: Student) => {
    confirmAction(
      "Remove from class?",
      `${student.full_name} will be removed from THIS class. Any other class they attend is untouched, and they return to the admin's unassigned list only if this was their last one. Lessons they have already attended are still billed, and their history is kept.`,
      async () => {
        setRemovingId(student.id);
        // `id` — this screen's own class, never the child's "the" class. Since
        // Wave 2 a child may be in several, and the roster a coach is looking at
        // is the only one they have any business closing.
        const { error } = await removeFromClass(supabase, student.id, id);
        setRemovingId(null);
        if (error) {
          showToast(`Could not remove ${student.full_name}.`, "error");
          return;
        }
        showToast(`${student.full_name} removed from this class.`, "success");
        loadData();
      },
      "Remove"
    );
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {classInfo?.title ?? "Class"}
          </Text>
          <Text className="text-xs text-gray-500">
            {capitalize(classInfo?.day_of_week ?? "")} ·{" "}
            {formatTime(classInfo?.start_time ?? "")} –{" "}
            {formatTime(classInfo?.end_time ?? "")}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Mark attendance — the most recent expected lesson within the window.
            No target = no lesson has fallen due yet (e.g. a brand-new class). */}
        <View className="mb-5">
          {markTarget ? (
            <>
              <PrimaryButton
                label={`Mark Attendance — ${formatDate(markTarget.date)}${
                  markTarget.date === todayDate ? " (Today)" : ""
                }`}
                onPress={() =>
                  router.push(
                    `/(coach)/classes/${id}/attendance?date=${markTarget.date}&from=roster`
                  )
                }
              />
              {windowStart && (
                <Text className="text-xs text-gray-400 mt-2 text-center">
                  You can mark lessons back to {formatDate(windowStart)}. Earlier
                  lessons are closed — a correction to an already-invoiced lesson
                  uses a credit note instead.
                </Text>
              )}
            </>
          ) : (
            <Card className="items-center py-6 border-sky-100 bg-sky-50">
              <Ionicons name="calendar-outline" size={28} color="#7dd3fc" />
              <Text className="text-gray-600 font-semibold mt-2">
                No lessons to mark yet
              </Text>
              <Text className="text-xs text-gray-500 mt-1 text-center">
                {students.length === 0
                  ? "Assign students to this class first."
                  : "This class's first lesson hasn't taken place yet — nothing to mark."}
              </Text>
            </Card>
          )}
        </View>

        {/* ── Trials coming up ─────────────────────────────────────────────
            Listed ABOVE the roster because it is the thing the coach does not
            already know. They are guests for one lesson, not members, so they
            are deliberately a separate list rather than mixed into the roster —
            mixing them would imply a weekly student. */}
        {upcomingTrials.length > 0 && (
          <View className="mb-5 bg-sky-50 rounded-2xl p-4 border border-sky-100">
            <Text className="text-sm font-bold text-sky-900">
              Trial{upcomingTrials.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingTrials.map((tr) => (
              <View
                key={`${tr.id}-${tr.session_date}`}
                className="mt-2 flex-row items-center justify-between"
              >
                <Text className="text-sm text-sky-900">{tr.full_name}</Text>
                <Text className="text-xs font-medium text-sky-700">
                  {formatSgDate(tr.session_date)}
                </Text>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-sky-700">
              Trying one lesson — mark them like anyone else on the day.
            </Text>
          </View>
        )}

        {/* ── Make-ups coming up ───────────────────────────────────────────
            An enrolled child from another class of the same kind, guesting
            for one lesson. Separate from trials because the coach's job
            differs: a make-up child is not new to the business, and the
            ordinary statuses apply — there is nothing to sell. */}
        {upcomingMakeups.length > 0 && (
          <View className="mb-5 bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
            <Text className="text-sm font-bold text-emerald-900">
              Make-up{upcomingMakeups.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingMakeups.map((mk) => (
              <View
                key={`${mk.id}-${mk.session_date}`}
                className="mt-2 flex-row items-center justify-between"
              >
                <Text className="text-sm text-emerald-900">{mk.full_name}</Text>
                <Text className="text-xs font-medium text-emerald-700">
                  {formatSgDate(mk.session_date)}
                </Text>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-emerald-700">
              Joining this one lesson as a make-up — mark them like anyone
              else on the day.
            </Text>
          </View>
        )}

        {/* ── Extra lessons coming up ──────────────────────────────────────
            A lesson on a day this class does not normally run, arranged by the
            business's admin. Shown here for the same reason trials are: it is
            the thing the coach does not already know, and their weekday-based
            expectation of this class will not produce it. */}
        {upcomingExtras.length > 0 && (
          <View className="mb-5 bg-amber-50 rounded-2xl p-4 border border-amber-100">
            <Text className="text-sm font-bold text-amber-900">
              Extra lesson{upcomingExtras.length === 1 ? "" : "s"} coming up
            </Text>
            {upcomingExtras.map((ex) => (
              <View key={ex.id} className="mt-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm text-amber-900">{ex.reason}</Text>
                  <Text className="text-xs font-medium text-amber-700">
                    {formatSgDate(ex.session_date)}
                  </Text>
                </View>
              </View>
            ))}
            <Text className="mt-2 text-[11px] text-amber-700">
              Not this class's usual day — mark it as normal once it has taken
              place.
            </Text>
          </View>
        )}

        {/* Enrolled Students */}
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-base font-bold text-gray-900">
            Students ({students.length})
          </Text>
        </View>

        <View className="gap-2 mb-6">
          {students.length === 0 ? (
            <Card className="items-center py-6">
              <Text className="text-gray-400 text-sm">No students enrolled</Text>
            </Card>
          ) : (
            students.map((student) => (
              <Card key={student.id}>
               <View className="flex-row items-center gap-3">
                <View className="w-9 h-9 rounded-full bg-sky-100 items-center justify-center">
                  <Text className="text-sky-600 font-bold text-sm">
                    {student.full_name.charAt(0)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-gray-800">
                    {student.full_name}
                  </Text>
                  {/* Age is the everyday useful fact. The BIRTHDAY only appears
                      when another child on this roster shares the name — that
                      is the case the identity rule exists for, and two children
                      of the same name can easily be the same age, so age alone
                      would not tell them apart. */}
                  {(() => {
                    const age = ageFromDob(student.date_of_birth);
                    const ambiguous = duplicateNames.has(
                      student.full_name.trim().toLowerCase()
                    );
                    if (age === null && !ambiguous && !student.level_label) return null;
                    return (
                      <Text className="text-xs text-gray-500 mt-0.5">
                        {student.level_label ? `${student.level_label} · ` : ""}
                        {age !== null ? `Age ${age}` : "Age unknown"}
                        {/* WITH THE YEAR — formatSgDate's default omits it,
                            and the year is usually the only thing separating
                            two children of the same name. "born 10 Mar" would
                            render identically for both of them. */}
                        {ambiguous && student.date_of_birth
                          ? ` · born ${formatSgDate(student.date_of_birth, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : ""}
                      </Text>
                    );
                  })()}
                </View>
                {/* Grade this child against their level's skills. A direct leaf
                    <Text> inside the Pressable — RN-web swallows the tap
                    otherwise (§7.10-adjacent). */}
                <Pressable
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${id}/grade?studentId=${student.id}`
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200"
                >
                  <Text className="text-xs font-semibold text-sky-600">Grade</Text>
                </Pressable>
                {/* A child who has stopped coming keeps this class permanently
                    "incomplete" — every lesson expects a mark for them — and
                    that now blocks invoicing outright. This is the in-app way
                    out. */}
                <Pressable
                  onPress={() => handleRemove(student)}
                  disabled={removingId === student.id}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200"
                >
                  <Text className="text-xs font-semibold text-gray-500">
                    {removingId === student.id ? "Removing…" : "Remove"}
                  </Text>
                </Pressable>
               </View>

                {/* The level's curriculum, on tap. Collapsed by default: a
                    roster of six children on three levels would otherwise be
                    thirty lines of skills, and the coach opens the one they
                    are teaching. */}
                {student.level_label &&
                (student.level_skills.length > 0 || student.level_note) ? (
                  <Pressable
                    onPress={() =>
                      setOpenLevelFor(
                        openLevelFor === student.id ? null : student.id
                      )
                    }
                    className="mt-2 pt-2 border-t border-gray-100"
                  >
                    <Text className="text-xs font-medium text-sky-600">
                      {openLevelFor === student.id ? "Hide" : "What"}{" "}
                      {student.level_label} {openLevelFor === student.id ? "" : "covers"}
                    </Text>
                  </Pressable>
                ) : null}

                {openLevelFor === student.id ? (
                  <View className="mt-2 gap-1.5">
                    {student.level_note ? (
                      <Text className="text-xs italic text-gray-500 mb-1">
                        {student.level_note}
                      </Text>
                    ) : null}
                    {student.level_skills.map((skill, i) => (
                      <View key={`${skill}-${i}`} className="flex-row gap-2">
                        <Text className="text-xs text-sky-500 font-semibold w-3.5">
                          {i + 1}
                        </Text>
                        <Text className="text-xs text-gray-700 flex-1">{skill}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </View>

        {/* Past Sessions */}
        <Text className="text-base font-bold text-gray-900 mb-3">
          Past Sessions
        </Text>

        {sessions.length === 0 ? (
          <Card className="items-center py-6">
            <Ionicons name="calendar-outline" size={32} color="#d1d5db" />
            <Text className="text-gray-400 mt-2 text-sm">
              No sessions recorded yet
            </Text>
          </Card>
        ) : (
          <View className="gap-2">
            {sessions.map((session) => {
              const cancelled = session.cancelled === true;
              const complete = isFinished(session.progress);
              const unmarked = session.id === null;
              return (
                <TouchableOpacity
                  key={session.session_date}
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${id}/attendance?date=${session.session_date}&from=roster`
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Card
                    className={`flex-row items-center gap-3 ${
                      cancelled
                        ? "opacity-60"
                        : unmarked
                        ? "border-orange-200 bg-orange-50"
                        : ""
                    }`}
                  >
                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center ${
                        cancelled
                          ? "bg-gray-100"
                          : complete
                          ? "bg-green-100"
                          : "bg-orange-100"
                      }`}
                    >
                      <Ionicons
                        name={cancelled ? "close" : complete ? "checkmark" : "alert"}
                        size={18}
                        color={cancelled ? "#6b7280" : complete ? "#16a34a" : "#ea580c"}
                      />
                    </View>
                    <View className="flex-1">
                      <Text
                        className={`text-sm font-semibold ${
                          cancelled ? "text-gray-500 line-through" : "text-gray-800"
                        }`}
                      >
                        {formatDate(session.session_date)}
                      </Text>
                      <Text
                        className={`text-xs ${
                          cancelled
                            ? "text-gray-500"
                            : complete
                            ? "text-green-600"
                            : "text-orange-500"
                        }`}
                      >
                        {cancelled
                          ? "Cancelled by your admin"
                          : progressLabel(session.progress)}
                      </Text>
                      {/* Omitted entirely when nothing is recorded — never a
                          dangling separator. A cancelled lesson shows its
                          reason instead, so the coach knows why it is struck. */}
                      {session.summary ? (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {session.summary}
                        </Text>
                      ) : cancelled && session.cancelReason ? (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {session.cancelReason}
                        </Text>
                      ) : null}
                    </View>
                    <View className="flex-row items-center gap-1">
                      <Text className="text-xs text-sky-500">
                        {complete ? "Edit" : "Mark"}
                      </Text>
                      <Ionicons name="chevron-forward" size={13} color="#0ea5e9" />
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
