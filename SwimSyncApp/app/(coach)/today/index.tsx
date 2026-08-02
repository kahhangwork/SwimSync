import React, { useState, useCallback } from "react";
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
  dayOfWeekOf,
  expectedLessonDates,
  backlogWindowStart,
  toSgDate,
  formatSgDate,
  type DayOfWeek,
} from "@/lib/lessonDates";
import {
  type EnrolmentSpan,
  isLessonFullyMarked,
  expectedStudentsOn,
} from "@/lib/attendanceCompleteness";
import {
  nowMinutesInSg,
  isNowInRange,
  hasEndedInSg,
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
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";

type TodayClass = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  location_name: string;
  /** Weekly, enrolled children expected at TODAY's lesson. */
  student_count: number;
  /** Trial or make-up children guesting at this ONE lesson. Counted apart from
   *  students, never folded in — the `2+1`-not-`3` rule (PRD §7.3, §7.17).
   *  `student_count + guest_count` is exactly the chip's denominator. */
  guest_count: number;
  session_id: string | null; // null if no lesson session generated for today yet
  /** Marked / partial / upcoming / not-marked / no-students. */
  progress: LessonProgress;
  /** "3 present · 2 cancelled (rain)", or "" when nothing is recorded. */
  summary: string;
};

/** A past lesson that should have happened but has no complete attendance. */
type BacklogItem = {
  class_id: string;
  class_title: string;
  date: string;
  session_id: string | null; // non-null when the session exists but is partial
  /** Only ever `partial` or `unmarked` — a complete lesson is not in the backlog. */
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

/**
 * The status pill. One component for both lists, so a state cannot be worded or
 * coloured one way on a card and another way in the backlog.
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

export default function TodayScreen() {
  const session = useAppStore((s) => s.session);
  const [classes, setClasses] = useState<TodayClass[]>([]);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Everything below derives from this one date string, so the weekday we query
  // by can never disagree with the date we write attendance to.
  const todayDate = todayInSg();
  const todayDayOfWeek = dayOfWeekOf(todayDate);
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

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    // Get coach record
    const { data: coach } = await supabase
      .from("coaches")
      .select("id")
      .eq("profile_id", session.id)
      .single();

    if (!coach) {
      setLoading(false);
      return;
    }

    // All of the coach's active classes — today's cards and the unmarked-lesson
    // backlog are derived from this one set so they can't disagree.
    const { data: allClasses } = await supabase
      .from("classes")
      .select(`
        id,
        title,
        day_of_week,
        start_time,
        end_time,
        location_name,
        student_class_enrolments(student_id, is_active, enrolled_at, unenrolled_at)
      `)
      .eq("coach_id", coach.id)
      .eq("is_active", true)
      .order("start_time", { ascending: true });

    const coachClasses = allClasses ?? [];
    const classIds = coachClasses.map((c: any) => c.id);

    // Sessions (with who's been marked) across the backlog window up to today.
    // The window floor ignores enrolment here so one query covers every class;
    // each class narrows it further below.
    //
    // Refetched on every focus of the coach's landing tab. At ~4 classes × ~9
    // sessions × ~17 students that's a few hundred joined rows — fine, but it
    // grows with classes × students, and PostgREST's `max_rows = 1000`
    // (supabase/config.toml) is a silent ceiling: past it the backlog would
    // under-report rather than error. Paginate or move server-side before then.
    const windowStart = backlogWindowStart(todayDate, null);
    const { data: windowSessions } = classIds.length > 0
      ? await supabase
          .from("lesson_sessions")
          .select("id, class_id, session_date, attendance(student_id, status)")
          .in("class_id", classIds)
          .gte("session_date", windowStart)
          .lte("session_date", todayDate)
      : { data: [] };

    // key: "<class_id>:<session_date>"
    const sessionByClassDate = new Map<
      string,
      {
        id: string;
        markedStudentIds: Set<string>;
        /** For the breakdown line. Same rows, one extra column. */
        statusByStudent: Map<string, DbStatus>;
      }
    >();
    // Dates that HAVE a session, per class. Needed because a lesson can exist
    // without being derivable from the class's weekday — an off-schedule lesson
    // scheduled by the admin (schedule_extra_lesson) is exactly that. Without
    // this the coach's backlog would never mention it, while the billing
    // engine's gate DOES see it (its datesToCheck unions existing session
    // dates), so the month would stall with nothing anywhere saying why.
    const sessionDatesByClass = new Map<string, string[]>();
    (windowSessions ?? []).forEach((s: any) => {
      sessionByClassDate.set(`${s.class_id}:${s.session_date}`, {
        id: s.id,
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

    // Lessons that should have happened but aren't fully marked. A lesson is
    // only "marked" once every active student has an attendance row — the same
    // rule the invoice engine's completeness gate uses.
    // Trial AND make-up bookings across this coach's classes. A booked child
    // is expected at ONE lesson and is not enrolled here, so without these an
    // unmarked booking never reaches the coach's backlog — while the invoice
    // engine refuses to close the month over it. The two must agree (§7.18).
    // Both kinds satisfy the same "expected at one lesson" contract, so they
    // merge into one map — exactly as the engine merges them (core.ts).
    const [{ data: bookingRows }, { data: makeupRows }] = await Promise.all([
      supabase
        .from("trial_bookings")
        .select("class_id, student_id, session_date")
        .is("cancelled_at", null),
      supabase
        .from("makeup_bookings")
        .select("class_id, student_id, session_date")
        .is("cancelled_at", null),
    ]);

    const bookedByClassDate = new Map<string, Map<string, string[]>>();
    for (const b of [...(bookingRows ?? []), ...(makeupRows ?? [])]) {
      const perClass =
        bookedByClassDate.get(b.class_id as string) ?? new Map<string, string[]>();
      const list = perClass.get(b.session_date as string) ?? [];
      list.push(b.student_id as string);
      perClass.set(b.session_date as string, list);
      bookedByClassDate.set(b.class_id as string, perClass);
    }

    const items: BacklogItem[] = [];
    // Today's status per class, derived in the SAME loop as the backlog and from
    // the SAME expected-set call. Two derivations of "who was expected here" is
    // how the client became the only effective billing gate once before (§7.18),
    // so there is exactly one `expectedStudentsOn` per (class, date) in this file.
    const todayByClass = new Map<
      string,
      {
        progress: LessonProgress;
        summary: string;
        /** Derived from the SAME expected set as `progress`, by subtraction —
         *  see splitExpected. Never a second head-count. */
        students: number;
        guests: number;
      }
    >();

    for (const cls of coachClasses as any[]) {
      const enrolments = cls.student_class_enrolments ?? [];
      const activeStudentIds = enrolments
        .filter((e: any) => e.is_active)
        .map((e: any) => e.student_id);
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
      // ── TODAY'S CARD ─────────────────────────────────────────────────────
      // Computed BEFORE the skip below, deliberately: a class with nobody
      // enrolled still gets a card, and it must read "No students" rather than
      // silently showing the same blue button as a class that needs marking.
      if (cls.day_of_week === todayDayOfWeek) {
        const sessToday = sessionByClassDate.get(`${cls.id}:${todayDate}`);
        const expectedToday = expectedStudentsOn(
          todayDate,
          enrolmentSpans,
          bookedHere
        );
        // Students vs guests, split out of the SAME `expectedToday` array that
        // feeds the chip below — by subtraction, so the card's head-count and
        // the chip's denominator cannot disagree (§7.18, and see splitExpected).
        // The card used to print the class's ACTIVE ENROLMENT count instead,
        // which excluded guests: "4 students" beside "3 of 5 marked".
        const split = splitExpected(
          expectedToday,
          bookedHere.get(todayDate) ?? []
        );
        todayByClass.set(cls.id, {
          // Keyed to the class's END time: a coach marks at the end of a lesson,
          // so one still running is "Upcoming", not overdue.
          progress: lessonProgress(expectedToday, sessToday?.markedStudentIds, {
            hasEnded: hasEndedInSg(cls.end_time, nowMins),
          }),
          summary: formatSummary(
            summariseStatuses(
              expectedToday,
              sessToday?.statusByStudent ?? new Map()
            )
          ),
          students: split.students,
          guests: split.guests,
        });
      }

      // Nothing enrolled AND nothing booked means nothing to mark. Checking
      // enrolments alone would skip a class whose only attendee is a trial.
      if (activeStudentIds.length === 0 && bookedHere.size === 0) continue;

      // Bound by the earliest enrolment (active or not) so we never ask about
      // lessons from before the class had anyone in it.
      const earliest = enrolments
        .map((e: any) => toSgDate(e.enrolled_at))
        .sort()[0];
      const from = backlogWindowStart(todayDate, earliest ?? null);

      // Booking dates join the expected list: a trial on a date with no session
      // would otherwise never appear here.
      //
      // So do dates that ALREADY HAVE A SESSION. A lesson the admin scheduled
      // off the class's weekday is not derivable from day_of_week, so deriving
      // alone would leave it out of the coach's backlog entirely — while the
      // billing engine still blocks the month on it. The same union the engine
      // makes (core.ts datesToCheck), for the same reason.
      const dates = [
        ...new Set([
          ...expectedLessonDates(cls.day_of_week as DayOfWeek, from, todayDate),
          ...[...bookedHere.keys()].filter((d) => d <= todayDate),
          ...(sessionDatesByClass.get(cls.id) ?? []).filter(
            (d) => d >= from && d <= todayDate
          ),
        ]),
      ];

      for (const date of dates) {
        if (date === todayDate) continue; // today already has its own card
        const sess = sessionByClassDate.get(`${cls.id}:${date}`);
        const expected = expectedStudentsOn(date, enrolmentSpans, bookedHere);
        if (expected.length === 0) continue;
        if (!isLessonFullyMarked(expected, sess?.markedStudentIds)) {
          items.push({
            class_id: cls.id,
            class_title: cls.title,
            date,
            session_id: sess?.id ?? null,
            // A past lesson has always ended, so this is `partial` or
            // `unmarked` — never `upcoming`. MEMBERSHIP IS UNCHANGED by this:
            // the isLessonFullyMarked test above still decides who is here.
            progress: lessonProgress(expected, sess?.markedStudentIds, {
              hasEnded: true,
            }),
            summary: formatSummary(
              summariseStatuses(expected, sess?.statusByStudent ?? new Map())
            ),
          });
        }
      }
    }
    items.sort((a, b) => b.date.localeCompare(a.date)); // most recent first
    setBacklog(items);

    const mapped: TodayClass[] = coachClasses
      .filter((cls: any) => cls.day_of_week === todayDayOfWeek)
      .map((cls: any) => {
        const today = todayByClass.get(cls.id);
        return {
          id: cls.id,
          title: cls.title,
          start_time: cls.start_time,
          end_time: cls.end_time,
          location_name: cls.location_name,
          // From the expected set, NOT from `student_class_enrolments`. The
          // enrolment count is a different question ("who is in this class")
          // to the one the card asks ("who is at today's lesson"), and the two
          // differ by exactly the guests.
          student_count: today?.students ?? 0,
          guest_count: today?.guests ?? 0,
          session_id:
            sessionByClassDate.get(`${cls.id}:${todayDate}`)?.id ?? null,
          // The loop above sets this for every class running today. The fallback
          // is unreachable, and fails towards NAGGING rather than towards a
          // quiet card — see isFinished in lib/attendanceSummary.ts.
          progress: today?.progress ?? ({ kind: "unmarked" } as LessonProgress),
          summary: today?.summary ?? "",
        };
      });

    setClasses(mapped);

    // ⚠ NO INVOICE COUNT HERE, DELIBERATELY. This screen used to show an
    // "Outstanding" tile counting unpaid invoices across every parent the coach
    // serves — a number with no date bound, sitting between "Classes Today" and
    // "Students Today" where it read as a fact about today's lessons. It is
    // neither today-scoped nor lesson-shaped, and since payment collection
    // shipped (PRD §7.21) chasing an invoice is an admin-panel job with the
    // reference, the QR and the WhatsApp queue behind it. Removed 2026-08-02
    // along with the coach's invoice list; do not re-add a count here.
    setLoading(false);
  }, [session, todayDayOfWeek, todayDate]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const totalStudents = classes.reduce((s, c) => s + c.student_count, 0);
  const totalGuests = classes.reduce((s, c) => s + c.guest_count, 0);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting */}
        <View className="mb-6">
          <Text className="text-gray-500 text-sm">Good morning,</Text>
          <Text className="text-2xl font-bold text-gray-900">
            Coach {session?.fullName ?? "—"}
          </Text>
          <Text className="text-sm text-gray-400 mt-0.5">{todayStr}</Text>
        </View>

        {/* Stats row */}
        <View className="flex-row gap-3 mb-6">
          <View className="flex-1 bg-white rounded-2xl p-4 shadow-sm border border-gray-100 items-center">
            <Text className="text-2xl font-bold text-sky-600">
              {loading ? "—" : classes.length}
            </Text>
            <Text className="text-xs text-gray-500 mt-0.5 text-center">
              Classes Today
            </Text>
          </View>
          <View className="flex-1 bg-white rounded-2xl p-4 shadow-sm border border-gray-100 items-center">
            <Text className="text-2xl font-bold text-sky-600">
              {loading ? "—" : totalStudents}
            </Text>
            <Text className="text-xs text-gray-500 mt-0.5 text-center">
              Students Today
            </Text>
          </View>
          {/* Guests get their own tile rather than inflating the student count,
              for the same reason the cards keep them apart — a guest at one
              lesson is not a weekly student. Rendered only when there are any,
              so an ordinary day still reads as two clean numbers. */}
          {!loading && totalGuests > 0 && (
            <View className="flex-1 bg-white rounded-2xl p-4 shadow-sm border border-gray-100 items-center">
              <Text className="text-2xl font-bold text-emerald-600">
                {totalGuests}
              </Text>
              <Text className="text-xs text-gray-500 mt-0.5 text-center">
                {totalGuests === 1 ? "Guest Today" : "Guests Today"}
              </Text>
            </View>
          )}
        </View>

        {/* Unmarked past lessons — only rendered when there are any, so a coach
            who is up to date never sees a nag. */}
        {!loading && backlog.length > 0 && (
          <View className="mb-6">
            <Text className="text-lg font-bold text-gray-900 mb-1">
              Unmarked Lessons ({backlog.length})
            </Text>
            <Text className="text-xs text-gray-500 mb-3">
              These lessons have no attendance yet and won&apos;t be billed until
              they do.
            </Text>
            <View className="gap-2">
              {backlog.map((item) => (
                <TouchableOpacity
                  key={`${item.class_id}:${item.date}`}
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${item.class_id}/attendance?date=${item.date}&from=today` +
                        (item.session_id ? `&sessionId=${item.session_id}` : "")
                    )
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
                      {/* Tells a half-done lesson from an untouched one, which
                          the date alone never could. `progress` here is only ever
                          partial or unmarked — a complete lesson is not in this
                          list, and MEMBERSHIP IS UNCHANGED by this work. */}
                      <Text className="text-xs text-gray-500 mt-0.5">
                        {progressLabel(item.progress)}
                        {item.summary ? ` \u00b7 ${item.summary}` : ""}
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

        {/* Today's classes */}
        <Text className="text-lg font-bold text-gray-900 mb-3">
          Today's Classes
        </Text>

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : classes.length === 0 ? (
          <Card className="items-center py-10">
            <Ionicons name="sunny-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 text-sm">No classes today</Text>
          </Card>
        ) : (
          <View className="gap-3">
            {classes.map((cls) => {
              const isActive = isNowInRange(cls.start_time, cls.end_time, nowMins);
              return (
                <Card
                  key={cls.id}
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
                      <Text className="text-base font-bold text-gray-900">
                        {cls.title}
                      </Text>
                      <View className="flex-row items-center gap-1.5 mt-1">
                        <Ionicons name="time-outline" size={13} color="#6b7280" />
                        <Text className="text-xs text-gray-500">
                          {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5 mt-0.5">
                        <Ionicons name="location-outline" size={13} color="#6b7280" />
                        <Text className="text-xs text-gray-500">
                          {cls.location_name}
                        </Text>
                      </View>
                    </View>
                    <ProgressChip progress={cls.progress} />
                  </View>

                  {/* Option A: the count moved off the top-right to make room
                      for the status, and reads as the total the breakdown adds
                      up to. The breakdown itself is omitted entirely when
                      nothing is recorded — never a dangling separator. */}
                  <Text className="text-xs text-gray-500 mb-3 -mt-1">
                    {formatAttendees(cls.student_count, cls.guest_count)}
                    {cls.summary ? ` \u00b7 ${cls.summary}` : ""}
                  </Text>

                  {/* isFinished, NOT `kind !== "unmarked"`. A card that stops
                      asking for marks it still needs is a lesson that never gets
                      marked, and that blocks the month with no override (§8a).
                      Any state added later inherits the loud button. */}
                  <PrimaryButton
                    label={isFinished(cls.progress) ? "Edit attendance" : "Mark Attendance"}
                    variant={isFinished(cls.progress) ? "outline" : "primary"}
                    onPress={() =>
                      router.push(
                        `/(coach)/classes/${cls.id}/attendance?date=${todayDate}&from=today${cls.session_id ? `&sessionId=${cls.session_id}` : ""}`
                      )
                    }
                  />
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
