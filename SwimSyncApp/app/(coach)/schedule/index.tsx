import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import {
  todayInSg,
  backlogWindowStart,
  toSgDate,
  formatSgDate,
  type DayOfWeek,
} from "@/lib/lessonDates";
import { fetchMarkableFloor } from "@/lib/markableFloor";
import {
  type EnrolmentSpan,
  isLessonFullyMarked,
  expectedStudentsOn,
} from "@/lib/attendanceCompleteness";
import {
  nowMinutesInSg,
  isNowInRange,
  hasLessonEnded,
} from "@/lib/timeOfDay";
import {
  lessonProgress,
  summariseStatuses,
  formatSummary,
  progressLabel,
  splitExpected,
  formatAttendees,
  isFinished,
  type LessonProgress,
  type DbStatus,
} from "@/lib/attendanceSummary";
import {
  mondayForOffset,
  weekBounds,
  weekLabel,
  selectableWeekOffsets,
  canGoBack,
  canGoForward,
  lessonDatesInRange,
} from "@/lib/scheduleWeek";
import { bucketWeek } from "@/lib/scheduleBuckets";
import {
  parseAssignments,
  assignmentsByLesson,
  rosteredDatesByClass,
  lessonRole,
  canMark,
  roleBadge,
  lessonKey,
  type LessonRole,
} from "@/lib/coachRoster";
import { fetchCoveredOutSessions } from "@/lib/sessionMainCoach";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";

/**
 * PostgREST caps every response at `max_rows = 1000` (supabase/config.toml) and
 * does it SILENTLY — past the cap you get fewer rows, not an error. An
 * under-reported NEEDS MARKING list looks exactly like being up to date, which
 * is the worst possible failure for a screen whose whole job is to stop a
 * lesson going unbilled. So ask for a bound BELOW the cap and treat hitting it
 * as a condition to shout about (see `truncated`).
 *
 * Do not assume this is unreachable: `markable_floor` falls back to the
 * tenant's `created_at` when a business has NEVER sealed a month, so a school
 * onboarded months ago that has not billed has a floor that far back.
 */
const ROW_LIMIT = 900;

/**
 * The class columns every card is built from. A COVERED class is fetched with
 * the same shape as an owned one — the substitute needs the title, the times
 * and the location just as much, and `classes_select` now returns it to them
 * (`coach_rostered_in_class`, 20260811000200).
 */
const CLASS_SELECT = `
        id,
        title,
        day_of_week,
        start_time,
        end_time,
        location_name,
        student_class_enrolments(student_id, is_active, enrolled_at, unenrolled_at)
      `;

/** One lesson on one date — the unit every section renders. */
type WeekLesson = {
  /** scheduleBuckets sorts on these two; the rest is for the card. */
  classId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
  sessionId: string | null;
  progress: LessonProgress;
  summary: string;
  students: number;
  guests: number;
  /** Who is teaching it. `owner` unless an admin has rostered somebody. */
  role: LessonRole;
  /** Cancelled in advance by the admin — shown struck, never marked. */
  cancelled: boolean;
};

/** A lesson that should have happened but has no complete attendance. */
type BacklogItem = {
  class_id: string;
  class_title: string;
  date: string;
  session_id: string | null;
  /** Only ever `partial` or `unmarked` — a complete lesson is not here. */
  progress: LessonProgress;
  summary: string;
};

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

const shortDate = (d: string) =>
  formatSgDate(d, { day: "numeric", month: "short" });
const dayHeading = (d: string) =>
  formatSgDate(d, { weekday: "short", day: "numeric", month: "short" });

/**
 * The status pill. One component for every section, so a state cannot be worded
 * or coloured one way here and another way there.
 *
 * Colour carries no information the text does not — the label is always present
 * — because a coach reading this outdoors on a phone is exactly the case where
 * colour alone fails.
 */
function ProgressChip({ progress }: { progress: LessonProgress }) {
  // `hex` as well as the Tailwind class: Ionicons takes a colour PROP and
  // ignores className, so without it the glyph renders default black inside a
  // coloured pill. Keep the two in step.
  const tone = {
    "no-students": { bg: "bg-gray-100",   fg: "text-gray-500",   hex: "#6b7280", icon: "remove-outline" },
    upcoming:      { bg: "bg-gray-100",   fg: "text-gray-500",   hex: "#6b7280", icon: "time-outline" },
    unmarked:      { bg: "bg-orange-100", fg: "text-orange-700", hex: "#c2410c", icon: "alert-circle-outline" },
    partial:       { bg: "bg-amber-100",  fg: "text-amber-700",  hex: "#b45309", icon: "ellipse-outline" },
    complete:      { bg: "bg-green-100",  fg: "text-green-700",  hex: "#15803d", icon: "checkmark-circle" },
  }[progress.kind];

  return (
    <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${tone.bg}`}>
      <Ionicons name={tone.icon as any} size={12} color={tone.hex} />
      <Text className={`text-xs font-semibold ${tone.fg}`}>
        {progressLabel(progress)}
      </Text>
    </View>
  );
}

/**
 * "Covering" / "Shadowing" / "Covered" — who is teaching a lesson, when it is
 * not simply the coach reading the screen.
 *
 * ⚠ VIOLET, AND NOT ONE OF THE PROGRESS CHIP'S COLOURS. This says something
 * orthogonal to marking state — a covered lesson can be unmarked, partial or
 * complete — and reusing amber or green here would read as a fourth status.
 * `null` for an ordinary lesson: a business that has never rostered anybody
 * gains no new furniture on its screens.
 *
 * Module scope for the same reason as `ProgressChip` and `DaySection` below.
 */
function RoleBadge({ role }: { role: LessonRole }) {
  const label = roleBadge(role);
  if (!label) return null;
  return (
    <View className="self-start rounded-full bg-violet-100 px-2 py-0.5 mt-1">
      <Text className="text-[10px] font-semibold text-violet-700">{label}</Text>
    </View>
  );
}

/**
 * A collapsed day under COMING UP or DONE.
 *
 * ⚠ MODULE SCOPE, NOT NESTED IN THE SCREEN. Declared inside the component body
 * this is a NEW component type on every render, so React unmounts and remounts
 * every COMING UP / DONE subtree on each one — including every expand press and
 * every `loading` flip. It survives that today only because it holds no state
 * of its own, and it stops surviving the moment anyone adds any. `ProgressChip`
 * is at module scope for the same reason.
 */
function DaySection({
  group,
  tappable,
  open,
  onToggle,
  onOpenLesson,
}: {
  group: { date: string; items: WeekLesson[] };
  tappable: boolean;
  open: boolean;
  onToggle: (date: string) => void;
  onOpenLesson: (l: WeekLesson) => void;
}) {
  const allMarked = group.items.every((l) => isFinished(l.progress));
  return (
    <View className="mb-2">
      <TouchableOpacity
        onPress={() => onToggle(group.date)}
        className="flex-row items-center gap-2 py-2"
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={14}
          color="#6b7280"
        />
        <Text className="text-sm font-semibold text-gray-700">
          {dayHeading(group.date)}
        </Text>
        <Text className="text-xs text-gray-400">
          {group.items.length === 1 ? "1 lesson" : `${group.items.length} lessons`}
        </Text>
        {allMarked && (
          <Ionicons name="checkmark-circle" size={14} color="#15803d" />
        )}
      </TouchableOpacity>

      {open && (
        <View className="gap-2 pl-6">
          {group.items.map((l) => (
            <TouchableOpacity
              key={`${l.classId}:${l.date}`}
              activeOpacity={tappable ? 0.8 : 1}
              onPress={() =>
                tappable
                  ? onOpenLesson(l)
                  : // ⚠ A FUTURE LESSON MUST NOT REACH THE ATTENDANCE SCREEN.
                    // checkMarkableDate refuses `date > today` outright, and
                    // refuses a booking on a non-weekday date too, so the only
                    // exit from there is a `replace` back here — a dead tap.
                    // The roster is the honest destination for "who is coming".
                    router.push(`/(coach)/classes/${l.classId}/roster`)
              }
            >
              <Card>
                <View className="flex-row items-start justify-between">
                  <View className="flex-1">
                    <Text
                      className={`text-sm font-bold ${
                        l.cancelled ? "text-gray-500 line-through" : "text-gray-900"
                      }`}
                    >
                      {l.title}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-0.5">
                      {formatTime(l.startTime)} – {formatTime(l.endTime)}
                    </Text>
                    {l.cancelled && (
                      <Text className="text-xs font-semibold text-gray-500 mt-0.5">
                        Cancelled by your admin
                      </Text>
                    )}
                    <RoleBadge role={l.role} />
                  </View>
                  <ProgressChip progress={l.progress} />
                </View>
                <Text className="text-xs text-gray-500 mt-1">
                  {formatAttendees(l.students, l.guests)}
                  {l.summary ? ` · ${l.summary}` : ""}
                </Text>
              </Card>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function ScheduleScreen() {
  const session = useAppStore((s) => s.session);

  // ⚠ AN OFFSET, NEVER A STORED MONDAY. `useState(startOfWeek(todayInSg()))`
  // evaluates ONCE, at mount — and this app is a home-screen PWA that stays
  // mounted for days. Survive a Sunday→Monday boundary with an absolute Monday
  // in state and it is now LAST week's: the TODAY section disappears and the
  // header quietly reads "Last week", so today's lessons are missing from the
  // coach's landing tab with nothing saying why. An offset re-derives from the
  // current `todayDate` on every render and self-corrects. A new axis on §7.7 —
  // not a wrong clock, a FROZEN one.
  const [weekOffset, setWeekOffset] = useState(0);

  /** FLOOR-scoped and week-INDEPENDENT. See the comment on loadData. */
  const [needsMarking, setNeedsMarking] = useState<BacklogItem[]>([]);
  const [weekLessons, setWeekLessons] = useState<WeekLesson[]>([]);
  const [floor, setFloor] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Everything below derives from this one date string, so the weekday we query
  // by can never disagree with the date we write attendance to.
  const todayDate = todayInSg();
  // Read ONCE per render, in Singapore, and passed to every comparison below.
  // The functions that use it take a number and cannot read a clock themselves,
  // so the device's timezone has no way in (§7.7, lib/timeOfDay.ts).
  const nowMins = nowMinutesInSg();
  const todayStr = formatSgDate(todayDate, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const selectedMonday = mondayForOffset(todayDate, weekOffset);
  const { start: weekStart, end: weekEnd } = weekBounds(selectedMonday);
  const bounds = selectableWeekOffsets(
    todayDate,
    backlogWindowStart(todayDate, null, floor)
  );
  /** The ONLY definition of "this week" — see the weekOffset comment. */
  const showsTodaySection = weekOffset === 0;
  /** "" for weeks further out than last/this/next — the range speaks for itself. */
  const label = weekLabel(selectedMonday, todayDate);

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
      supabase.from("coaches").select("id").eq("profile_id", session.id).single(),
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
      supabase
        .from("classes")
        .select(CLASS_SELECT)
        .eq("coach_id", coach.id)
        .eq("is_active", true)
        .order("start_time", { ascending: true }),
      // ⚠ BOUNDED BY THE SESSION'S DATE, THROUGH THE EMBED. `!inner` is what
      // makes a filter on the embedded table narrow the parent rows rather than
      // just the embed, and without it every assignment a coach has ever had
      // comes back to be discarded on the device.
      supabase
        .from("session_coaches")
        .select("lesson_session_id, lesson_sessions!inner(id, class_id, session_date)")
        .eq("coach_id", coach.id)
        .gte("lesson_sessions.session_date", rangeStart)
        .lte("lesson_sessions.session_date", rangeEnd)
        .limit(ROW_LIMIT),
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
    const coveredClassIds = [...rosteredDates.keys()].filter(
      (id) => !ownedClassIds.has(id)
    );
    const coveredRes =
      coveredClassIds.length > 0
        ? await supabase.from("classes").select(CLASS_SELECT).in("id", coveredClassIds)
        : { data: [] as any[] };
    if (!current()) return;

    // ── (c) THE CLASSES I SHADOW ──────────────────────────────────────────
    // ⚠ ACTIVE TODAY, not "on the lesson's date". Visibility and pay ask
    // different questions of the same dated record (20260812000200 §4): once an
    // assignment ENDS the class leaves my app entirely, even though I am still
    // paid for the lessons inside its range. Filtering by the range here would
    // keep showing an ex-shadow a class they no longer have anything to do with.
    const { data: shadowRows } = await supabase
      .from("class_shadow_coaches")
      .select("class_id, effective_from, effective_to")
      .eq("coach_id", coach.id)
      .lte("effective_from", todayDate)
      .or(`effective_to.is.null,effective_to.gte.${todayDate}`)
      .limit(ROW_LIMIT);
    if (!current()) return;

    const shadowClassIds = [
      ...new Set((shadowRows ?? []).map((r: any) => r.class_id as string)),
    ].filter((id) => !ownedClassIds.has(id) && !coveredClassIds.includes(id));

    const shadowRes =
      shadowClassIds.length > 0
        ? await supabase.from("classes").select(CLASS_SELECT).in("id", shadowClassIds)
        : { data: [] as any[] };
    if (!current()) return;

    const shadowedClassIds = new Set(shadowClassIds);

    /** Every class a card can come from, each carrying whether it is mine and
     *  whether I merely shadow it. The two flags are never both true — the
     *  database refuses a shadow assignment on a class the coach owns. */
    const coachClasses: { cls: any; owned: boolean; shadowed: boolean }[] = [
      ...ownedClasses.map((cls: any) => ({ cls, owned: true, shadowed: false })),
      ...((coveredRes.data ?? []) as any[]).map((cls: any) => ({
        cls,
        owned: false,
        shadowed: false,
      })),
      ...((shadowRes.data ?? []) as any[]).map((cls: any) => ({
        cls,
        owned: false,
        shadowed: shadowedClassIds.has(cls.id),
      })),
    ];
    const classIds = coachClasses.map((c) => c.cls.id as string);

    const sessionsRes = classIds.length > 0
      ? await supabase
          .from("lesson_sessions")
          .select("id, class_id, session_date, cancelled_at, attendance(student_id, status)")
          .in("class_id", classIds)
          .gte("session_date", rangeStart)
          .lte("session_date", rangeEnd)
          .limit(ROW_LIMIT)
      : { data: [] as any[] };
    const windowSessions = sessionsRes.data ?? [];

    // key: "<class_id>:<session_date>"
    const sessionByClassDate = new Map<
      string,
      {
        id: string;
        /** Cancelled in advance by the admin (cancel_lesson): expects nobody
         *  enrolled, takes no marks (the DB trigger refuses — this is cosmetic). */
        cancelled: boolean;
        markedStudentIds: Set<string>;
        statusByStudent: Map<string, DbStatus>;
      }
    >();
    // Dates that HAVE a session, per class. Needed because a lesson can exist
    // without being derivable from the class's weekday — an off-schedule lesson
    // scheduled by the admin (schedule_extra_lesson) is exactly that. Without
    // this the coach would never see it, while the billing engine's gate DOES
    // (its datesToCheck unions existing session dates), so the month would
    // stall with nothing anywhere saying why.
    const sessionDatesByClass = new Map<string, string[]>();
    windowSessions.forEach((s: any) => {
      sessionByClassDate.set(`${s.class_id}:${s.session_date}`, {
        id: s.id,
        cancelled: s.cancelled_at != null,
        markedStudentIds: new Set(
          (s.attendance ?? []).map((a: any) => a.student_id)
        ),
        statusByStudent: new Map(
          (s.attendance ?? []).map((a: any) => [a.student_id, a.status])
        ),
      });
      const dates = sessionDatesByClass.get(s.class_id as string) ?? [];
      dates.push(s.session_date as string);
      sessionDatesByClass.set(s.class_id as string, dates);
    });

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
        ? supabase
            .from("trial_bookings")
            .select("class_id, student_id, session_date")
            .is("cancelled_at", null)
            .in("class_id", classIds)
            .gte("session_date", rangeStart)
            .lte("session_date", rangeEnd)
            .limit(ROW_LIMIT)
        : Promise.resolve({ data: [] as any[] }),
      classIds.length > 0
        ? supabase
            .from("makeup_bookings")
            .select("class_id, student_id, session_date")
            .is("cancelled_at", null)
            .in("class_id", classIds)
            .gte("session_date", rangeStart)
            .lte("session_date", rangeEnd)
            .limit(ROW_LIMIT)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const bookingRows = bookingsRes.data ?? [];
    const makeupRows = makeupsRes.data ?? [];

    // A result that exactly fills its limit is indistinguishable from a
    // truncated one, so treat it as truncated and SAY SO on screen rather than
    // rendering a quietly short list that reads as "you are up to date".
    if (!current()) return;
    setTruncated(
      windowSessions.length >= ROW_LIMIT ||
        bookingRows.length >= ROW_LIMIT ||
        makeupRows.length >= ROW_LIMIT ||
        // The roster fetch is capped like the others, and a truncated one drops
        // lessons a substitute is expected to mark — the same silent shortfall,
        // one table further on. Counted on the RAW rows, not the parsed ones:
        // parsing drops a row whose lesson did not come back, which would hide
        // a response that really did fill its limit.
        (rosterRes.data?.length ?? 0) >= ROW_LIMIT
    );

    const bookedByClassDate = new Map<string, Map<string, string[]>>();
    for (const b of [...bookingRows, ...makeupRows]) {
      const perClass =
        bookedByClassDate.get(b.class_id as string) ?? new Map<string, string[]>();
      const list = perClass.get(b.session_date as string) ?? [];
      list.push(b.student_id as string);
      perClass.set(b.session_date as string, list);
      bookedByClassDate.set(b.class_id as string, perClass);
    }

    const backlogItems: BacklogItem[] = [];
    const lessons: WeekLesson[] = [];
    /** Sessions of MY OWN classes that somebody else might have been rostered
     *  onto — see the probe below for why this list is short. */
    const probeIds: string[] = [];

    for (const { cls, owned, shadowed } of coachClasses) {
      const enrolments = cls.student_class_enrolments ?? [];
      // Who must be marked is a question about the LESSON'S date — a child who
      // joined last week was not expected at last month's lessons. See
      // EnrolmentSpan in lib/attendanceCompleteness.ts.
      const enrolmentSpans: EnrolmentSpan[] = enrolments.map((e: any) => ({
        studentId: e.student_id as string,
        from: toSgDate(e.enrolled_at),
        until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
      }));
      const bookedHere =
        bookedByClassDate.get(cls.id) ?? new Map<string, string[]>();
      const sessionDates = sessionDatesByClass.get(cls.id) ?? [];
      const bookedDates = [...bookedHere.keys()];
      const rosteredHere = rosteredDates.get(cls.id) ?? [];

      /**
       * Which dates of this class are MINE, inside a range.
       *
       * ⚠ THE TWO ARMS ARE NOT INTERCHANGEABLE. For my own class it is the
       * weekday recurrence, plus booking and session dates that fall off it
       * (an admin's extra lesson). For a class I am covering it is EXACTLY the
       * dates an admin rostered me onto — never the recurrence. A substitute
       * who covers one Tuesday is not owed a card for every Tuesday, and RLS
       * would return them no session for those dates anyway, so a recurrence
       * card there would be a permanently unmarkable "unmarked" lesson.
       */
      // ⚠ ONE NAMED PREDICATE, NOT TWO `||`s AT THE CALL SITE. A shadow sees
      // the class's WHOLE schedule, so their date source is the recurrence —
      // the same arm as an owner and the exact OPPOSITE of a substitute's.
      // Writing it inline invites somebody to widen the probe guard below to
      // match, and those are two different questions on adjacent lines.
      const showsWholeSchedule = owned || shadowed;

      const datesIn = (from: string, to: string): string[] =>
        showsWholeSchedule
          ? lessonDatesInRange(
              cls.day_of_week as DayOfWeek,
              from,
              to,
              bookedDates,
              sessionDates
            )
          : rosteredHere.filter((d) => d >= from && d <= to);

      /** My role on one date of this class, before the covered-out probe —
       *  one definition, used by the card and by the NEEDS MARKING filter, so
       *  a lesson cannot be badged one way and nagged the other. */
      const roleAt = (date: string) =>
        lessonRole({
          ownsClass: owned,
          isSubstitute: assignmentByLesson.has(lessonKey(cls.id, date)),
          isClassShadow: shadowed,
        });

      /** One (class, date) -> one card. Exactly ONE expectedStudentsOn call per
       *  pair in this file: two derivations of "who was expected here" is how
       *  the client became the only effective billing gate once before (§7.18). */
      const lessonAt = (date: string): WeekLesson => {
        const sess = sessionByClassDate.get(`${cls.id}:${date}`);
        // A lesson the admin cancelled in advance expects nobody ENROLLED — the
        // spans are withheld, the bookings are not (the same substitution the
        // engine makes, core.ts `unmarkedOn`; a live guest on a cancelled date
        // cannot exist, but if it did it must still show as owed a mark).
        const expected = sess?.cancelled
          ? expectedStudentsOn(date, [], bookedHere)
          : expectedStudentsOn(date, enrolmentSpans, bookedHere);
        // Students vs guests, split out of the SAME array that feeds the chip —
        // by subtraction, so the head-count and the chip's denominator cannot
        // disagree (the `2+1`-not-`3` rule, PRD §7.3/§7.17).
        const split = splitExpected(expected, bookedHere.get(date) ?? []);
        return {
          classId: cls.id,
          date,
          startTime: cls.start_time,
          endTime: cls.end_time,
          title: cls.title,
          location: cls.location_name,
          sessionId: sess?.id ?? null,
          // Past -> ended; future -> not; today -> ask the clock, keyed to the
          // class's END time because a coach marks at the end of a lesson.
          progress: lessonProgress(expected, sess?.markedStudentIds, {
            hasEnded: hasLessonEnded(date, todayDate, cls.end_time, nowMins),
          }),
          summary: formatSummary(
            summariseStatuses(expected, sess?.statusByStudent ?? new Map())
          ),
          students: split.students,
          guests: split.guests,
          // Provisional: `covered` is not known yet for my OWN classes — only
          // the database can answer that, and it is asked once, below, for the
          // handful of lessons where the answer can still change anything.
          role: roleAt(date),
          cancelled: sess?.cancelled ?? false,
        };
      };

      // ── THE SELECTED WEEK ────────────────────────────────────────────────
      // Every lesson in the week, marked or not — DONE needs the marked ones,
      // and a class with nobody enrolled still gets a card reading "No students"
      // rather than silently vanishing. (An empty roster is NOT "Marked": the
      // billing gate calls it complete and a card must not.)
      for (const date of datesIn(weekStart, weekEnd)) {
        const card = lessonAt(date);
        lessons.push(card);
        // ⚠ `owned`, NOT `showsWholeSchedule`. The covered-out probe answers
        // "has somebody else been made the main on MY lesson", and a shadowed
        // class is not mine — putting its sessions in would dilute a
        // subtraction whose every short answer HIDES a lesson that needs
        // marking (§7.138). Two different questions, adjacent lines.
        if (owned && card.sessionId && !isFinished(card.progress)) {
          probeIds.push(card.sessionId);
        }
      }

      // ── NEEDS MARKING — FLOOR-SCOPED, AND DELIBERATELY WEEK-INDEPENDENT ──
      // ⚠ THIS SET DOES NOT KNOW WHICH WEEK IS ON SCREEN, AND MUST NOT LEARN.
      // Its range is [class's own backlog floor, today] whatever the selector
      // says, so a straggler three weeks back is visible without the coach
      // having to navigate to a week they have no reason to suspect holds one.
      // Unmarked attendance blocks invoice generation outright with no override
      // — week-scoping this is the §8i hole reopened.
      //
      // Today is NOT skipped here. De-duplication against the TODAY section
      // happens in the RENDER body, over the same render's inputs, so the two
      // cannot disagree; doing it here would couple an async fetch to a
      // render-time fact and could leave today's lesson in neither section.
      // ⚠ THE LOWER BOUND IS THE BUSINESS-WIDE FLOOR, NOT THE PER-CLASS
      // ENROLMENT FLOOR — AND GETTING THAT WRONG DROPS A TRIAL.
      // The old Today screen bounded booking dates ABOVE only
      // (`[...bookedHere.keys()].filter(d => d <= todayDate)`) while bounding
      // session dates at both ends; extracting the union into
      // lessonDatesInRange applied both bounds to bookings too. With the
      // per-class `max(floor, earliestEnrolment)` as the lower bound, a class
      // that trialled a child on 15 Jul but took its first enrolment on 1 Aug
      // loses that unmarked trial from this list entirely — while
      // generate-invoices/core.ts unions booking dates with NO enrolment floor
      // and still blocks the month over it. §7.18 and §7.97, which this commit
      // wrote, reopened through the extraction itself.
      //
      // `backlogFrom` (floor only) restores it, and is strictly better than the
      // pre-extraction behaviour: unbounded-below also surfaced bookings BELOW
      // the marking floor, which nobody can record — a dead tap. Pre-enrolment
      // weekday dates are still suppressed, by `expected.length === 0` below.
      for (const date of datesIn(backlogFrom, todayDate)) {
        const sess = sessionByClassDate.get(`${cls.id}:${date}`);
        // Cancelled by the admin: nobody enrolled is owed a mark (see lessonAt).
        const expected = sess?.cancelled
          ? expectedStudentsOn(date, [], bookedHere)
          : expectedStudentsOn(date, enrolmentSpans, bookedHere);
        if (expected.length === 0) continue; // nobody to mark
        if (isLessonFullyMarked(expected, sess?.markedStudentIds)) continue;
        // A lesson that has not ENDED yet is not overdue — today's 5pm class at
        // midday is Upcoming, not a straggler.
        if (!hasLessonEnded(date, todayDate, cls.end_time, nowMins)) continue;
        // A lesson I am only SHADOWING is not mine to clear. The database
        // refuses my write (attendance_write is `coach_is_main_on_session`), so
        // nagging me produces a straggler nobody can answer — see canMark().
        if (!canMark(roleAt(date))) continue;
        // ⚠ `owned`, NOT `showsWholeSchedule` — see the probe note above.
        if (owned && sess) probeIds.push(sess.id);
        backlogItems.push({
          class_id: cls.id,
          class_title: cls.title,
          date,
          session_id: sess?.id ?? null,
          progress: lessonProgress(expected, sess?.markedStudentIds, {
            hasEnded: true,
          }),
          summary: formatSummary(
            summariseStatuses(expected, sess?.statusByStudent ?? new Map())
          ),
        });
      }
    }

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

    // A covered lesson LEAVES my NEEDS MARKING list and appears on the covering
    // coach's. Leaving it here shows a straggler I am not permitted to clear,
    // and unmarked attendance blocks the billing month with no override (§8i).
    const ownBacklog = backlogItems.filter(
      (b) => !(b.session_id && coveredOut.has(b.session_id))
    );
    // The week card STAYS — the lesson is still happening and the coach should
    // see their own class's day — it simply stops claiming to be theirs to mark
    // and says so through its badge.
    const weekCards = lessons.map((l) =>
      l.role === "owner" && l.sessionId && coveredOut.has(l.sessionId)
        ? { ...l, role: "covered" as LessonRole }
        : l
    );

    ownBacklog.sort((a, b) => b.date.localeCompare(a.date)); // most recent first
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

  // ⚠ ONE EFFECT, NOT TWO. `useFocusEffect` re-runs whenever its callback
  // identity changes WHILE FOCUSED, and `loadData` is rebuilt on every
  // `weekOffset` change — so it already covers pressing an arrow. An extra
  // `useEffect(..., [loadData])` beside it is not a safety net, it is a second
  // full four-query round on every mount and every arrow press.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
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
  const buckets = bucketWeek(
    weekLessons.filter((l) => !needsKeys.has(`${l.classId}:${l.date}`)),
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

  /** A collapsed day, expandable. Used by COMING UP and DONE. */

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting. The long-form SGT date is also the cheapest possible proof
            that this screen's date is the Singapore one, and verify-tz-saturday
            asserts on it (§7.7). */}
        <View className="mb-4">
          <Text className="text-gray-500 text-sm">Good morning,</Text>
          <Text className="text-2xl font-bold text-gray-900">
            Coach {session?.fullName ?? "—"}
          </Text>
          <Text className="text-sm text-gray-400 mt-0.5">{todayStr}</Text>
        </View>

        {/* ── WEEK SELECTOR ───────────────────────────────────────────────── */}
        <View className="flex-row items-center justify-between mb-4 bg-white rounded-2xl px-2 py-2 border border-gray-100">
          {/* testIDs because these are ICON-ONLY controls — there is no text
              for a driver to grab, and a positional click is exactly the
              brittleness §7.10/§7.58 punish. They render as data-testid on
              RN-web, so Playwright's getByTestId finds them. */}
          <TouchableOpacity
            testID="week-prev"
            disabled={!canGoBack(weekOffset, bounds.min)}
            onPress={() => setWeekOffset((w) => w - 1)}
            className="px-3 py-1.5"
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={canGoBack(weekOffset, bounds.min) ? "#0ea5e9" : "#d1d5db"}
            />
          </TouchableOpacity>

          <View className="items-center">
            <Text className="text-sm font-semibold text-gray-900">
              {shortDate(weekStart)} – {shortDate(weekEnd)}
            </Text>
            {label !== "" && (
              <Text className="text-xs text-sky-600">{label}</Text>
            )}
          </View>

          <TouchableOpacity
            testID="week-next"
            disabled={!canGoForward(weekOffset, bounds.max)}
            onPress={() => setWeekOffset((w) => w + 1)}
            className="px-3 py-1.5"
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={canGoForward(weekOffset, bounds.max) ? "#0ea5e9" : "#d1d5db"}
            />
          </TouchableOpacity>
        </View>

        {/* One tap back to the present. Marking a straggler correctly returns
            the coach to that past week, which is right for the straggler and
            wrong as a resting state. */}
        {weekOffset !== 0 && (
          <TouchableOpacity
            testID="week-today"
            onPress={() => setWeekOffset(0)}
            className="mb-4 self-start flex-row items-center gap-1"
          >
            <Ionicons name="today-outline" size={14} color="#0ea5e9" />
            <Text className="text-xs font-semibold text-sky-600">
              Back to this week
            </Text>
          </TouchableOpacity>
        )}

        {truncated && (
          <Card className="mb-4 border-amber-200 bg-amber-50">
            <Text className="text-sm font-semibold text-amber-800">
              Too many lessons to check at once
            </Text>
            <Text className="text-xs text-amber-700 mt-1">
              This list may be incomplete. Ask your admin before relying on it to
              tell you what still needs marking.
            </Text>
          </Card>
        )}

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : (
          <>
            {/* ── NEEDS MARKING ─────────────────────────────────────────────
                ⚠ THE HEADING STRING IS `NEEDS MARKING (N)` AND THE COUNT IS
                PART OF IT. Three drivers assert on it verbatim, and the
                parenthesised number is the only assertion that the floor-scoped
                set is neither larger nor smaller than it should be. Do not
                relax those regexes to a bare /NEEDS MARKING/. Keep this string
                UNIQUE on the screen too — a negative assertion elsewhere
                (`!/needs marking/i`) false-fails if the words appear twice. */}
            {visibleNeedsMarking.length > 0 && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-gray-900 mb-1">
                  NEEDS MARKING ({visibleNeedsMarking.length})
                </Text>
                <Text className="text-xs text-gray-500 mb-3">
                  These lessons have no attendance yet and won&apos;t be billed
                  until they do.
                </Text>
                <View className="gap-2">
                  {visibleNeedsMarking.map((item) => (
                    <TouchableOpacity
                      key={`${item.class_id}:${item.date}`}
                      onPress={() =>
                        openAttendance({
                          classId: item.class_id,
                          date: item.date,
                          sessionId: item.session_id,
                        })
                      }
                      activeOpacity={0.8}
                    >
                      <Card className="flex-row items-center gap-3 border-orange-200 bg-orange-50">
                        <View className="w-9 h-9 rounded-full bg-orange-100 items-center justify-center">
                          <Ionicons name="alert" size={18} color="#ea580c" />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-gray-800">
                            {item.class_title}
                          </Text>
                          <Text className="text-xs text-orange-600">
                            {formatSgDate(item.date)}
                          </Text>
                          <Text className="text-xs text-gray-500 mt-0.5">
                            {progressLabel(item.progress)}
                            {item.summary ? ` · ${item.summary}` : ""}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-1">
                          <Text className="text-xs font-semibold text-orange-600">
                            Mark
                          </Text>
                          <Ionicons name="chevron-forward" size={13} color="#ea580c" />
                        </View>
                      </Card>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* ── TODAY — only in the current week ───────────────────────── */}
            {showsTodaySection && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-gray-900">
                  TODAY · {dayHeading(todayDate)}
                </Text>
                {/* The three tiles this replaced (Classes / Students / Guests
                    Today) are folded in here — every number kept, the vertical
                    space reclaimed, because this screen is far denser than the
                    one-day screen it replaces. Guests stay counted APART from
                    students: a guest at one lesson is not a weekly student. */}
                <Text className="text-xs text-gray-500 mb-3">
                  {todayLessons.length === 0
                    ? "No lessons today."
                    : `${todayLessons.length === 1 ? "1 lesson" : `${todayLessons.length} lessons`} · ${formatAttendees(todayStudents, todayGuests)}`}
                </Text>

                <View className="gap-3">
                  {todayLessons.map((l) => {
                    const isActive = isNowInRange(l.startTime, l.endTime, nowMins);
                    return (
                      <Card
                        key={`${l.classId}:${l.date}`}
                        className={isActive ? "border-sky-200 bg-sky-50" : ""}
                      >
                        {isActive && (
                          <View className="flex-row items-center gap-1.5 mb-2">
                            <View className="w-2 h-2 rounded-full bg-green-500" />
                            <Text className="text-xs font-semibold text-green-600">
                              Now
                            </Text>
                          </View>
                        )}

                        <View className="flex-row items-start justify-between mb-3">
                          <View className="flex-1">
                            <Text
                              className={`text-base font-bold ${
                                l.cancelled ? "text-gray-500 line-through" : "text-gray-900"
                              }`}
                            >
                              {l.title}
                            </Text>
                            {l.cancelled && (
                              <Text className="text-xs font-semibold text-gray-500 mt-0.5">
                                Cancelled by your admin — nothing to mark
                              </Text>
                            )}
                            <View className="flex-row items-center gap-1.5 mt-1">
                              <Ionicons name="time-outline" size={13} color="#6b7280" />
                              <Text className="text-xs text-gray-500">
                                {formatTime(l.startTime)} – {formatTime(l.endTime)}
                              </Text>
                            </View>
                            <View className="flex-row items-center gap-1.5 mt-0.5">
                              <Ionicons name="location-outline" size={13} color="#6b7280" />
                              <Text className="text-xs text-gray-500">
                                {l.location}
                              </Text>
                            </View>
                            <RoleBadge role={l.role} />
                          </View>
                          <ProgressChip progress={l.progress} />
                        </View>

                        <Text className="text-xs text-gray-500 mb-3 -mt-1">
                          {formatAttendees(l.students, l.guests)}
                          {l.summary ? ` · ${l.summary}` : ""}
                        </Text>

                        {/* isFinished, NOT `kind !== "unmarked"`. A card that
                            stops asking for marks it still needs is a lesson
                            that never gets marked, and that blocks the month
                            with no override (§8a). Any state added later
                            inherits the loud button.

                            A lesson I am shadowing, or one another coach was
                            rostered to cover, is the ONE case where the loud
                            button is wrong: the database refuses my write, so
                            "Mark Attendance" could only ever end in an error
                            toast. The screen behind it still opens, read-only,
                            because knowing who is expected is the reason a
                            trainee is there at all. */}
                        <PrimaryButton
                          label={
                            !canMark(l.role)
                              ? "View lesson"
                              : isFinished(l.progress)
                                ? "Edit attendance"
                                : "Mark Attendance"
                          }
                          variant={
                            !canMark(l.role) || isFinished(l.progress)
                              ? "outline"
                              : "primary"
                          }
                          onPress={() => openAttendance(l)}
                        />
                      </Card>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── COMING UP ─────────────────────────────────────────────── */}
            {buckets.comingUp.length > 0 && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-gray-900 mb-2">
                  COMING UP
                </Text>
                {buckets.comingUp.map((g) => (
                  <DaySection
                    key={g.date}
                    group={g}
                    tappable={false}
                    open={expandedDays.has(g.date)}
                    onToggle={toggleDay}
                    onOpenLesson={openAttendance}
                  />
                ))}
              </View>
            )}

            {/* ── DONE ──────────────────────────────────────────────────── */}
            {buckets.done.length > 0 && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-gray-900 mb-2">DONE</Text>
                {buckets.done.map((g) => (
                  <DaySection
                    key={g.date}
                    group={g}
                    tappable={true}
                    open={expandedDays.has(g.date)}
                    onToggle={toggleDay}
                    onOpenLesson={openAttendance}
                  />
                ))}
              </View>
            )}

            {/* Only when there is no TODAY section to carry its own
                "No lessons today." line — otherwise an empty current week
                printed two empty states one above the other. */}
            {weekLessons.length === 0 &&
              visibleNeedsMarking.length === 0 &&
              !showsTodaySection && (
              <Card className="items-center py-10">
                <Ionicons name="sunny-outline" size={40} color="#d1d5db" />
                <Text className="text-gray-400 mt-3 text-sm">
                  No lessons this week
                </Text>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
