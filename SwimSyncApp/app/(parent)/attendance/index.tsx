import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import {
  todayInSg,
  toSgDate,
  expectedLessonDates,
  formatSgDate,
  type DayOfWeek,
} from "@/lib/lessonDates";
import {
  computeUpcomingLessons,
  UPCOMING_HORIZON_DAYS,
  type UpcomingLesson,
} from "@/lib/upcomingLessons";
import { addDays } from "@/lib/scheduleWeek";
import Card from "@/components/Card";

type DbStatus =
  | "present"
  | "absent"
  | "cancelled_rain"
  | "cancelled_coach"
  | "trial_paid"
  | "trial_free"
  | "holiday";

type FilterOption = "All" | "Present" | "Absent" | "Cancelled" | "Trial";

type AttendanceRecord = {
  id: string;
  status: DbStatus;
  session_date: string;
  class_title: string;
};

type Child = {
  id: string;
  full_name: string;
  // "inactive" was dropped from the enum — activity is its own axis now
  // (students.is_active), so a departed child must not read "Unassigned".
  assignment_status: "unassigned" | "assigned";
  is_active: boolean;
};

const FILTER_OPTIONS: FilterOption[] = ["All", "Present", "Absent", "Cancelled", "Trial"];

const STATUS_LABEL: Record<DbStatus, string> = {
  present:          "Present",
  absent:           "Absent",
  cancelled_rain:   "Cancelled (Rain)",
  cancelled_coach:  "Cancelled (Coach)",
  trial_paid:       "Trial — Paid",
  trial_free:       "Trial — Free",
  holiday:          "Public Holiday",
};

const STATUS_ICON: Record<DbStatus, { name: string; color: string }> = {
  present:         { name: "checkmark-circle", color: "#16a34a" },
  absent:          { name: "close-circle",     color: "#9ca3af" },
  cancelled_rain:  { name: "rainy",            color: "#ea580c" },
  cancelled_coach: { name: "ban",              color: "#ea580c" },
  trial_paid:      { name: "star",             color: "#2563eb" },
  trial_free:      { name: "star-outline",     color: "#2563eb" },
  holiday:         { name: "calendar",         color: "#9333ea" },
};

function matchesFilter(status: DbStatus, filter: FilterOption): boolean {
  if (filter === "All") return true;
  if (filter === "Present") return status === "present";
  if (filter === "Absent") return status === "absent";
  if (filter === "Cancelled") return status === "cancelled_rain" || status === "cancelled_coach";
  if (filter === "Trial") return status === "trial_paid" || status === "trial_free";
  return true;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// 24h "17:00:00" → "5:00 PM". Same shape the parent home screen uses.
function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function timeLabel(start: string | null, end: string | null): string {
  const s = formatTime(start);
  const e = formatTime(end);
  if (s && e) return `${s} – ${e}`;
  return s ?? "";
}

export default function AttendanceScreen() {
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

    const { data: parent } = await supabase
      .from("parents")
      .select("id")
      .eq("profile_id", session.id)
      .single();

    if (!parent) {
      setLoadingChildren(false);
      return;
    }

    const { data: links } = await supabase
      .from("parent_students")
      .select("students(id, full_name, assignment_status, is_active)")
      .eq("parent_id", parent.id);

    const childList: Child[] = (links ?? []).map((l: any) => ({
      id: l.students.id,
      full_name: l.students.full_name,
      assignment_status: l.students.assignment_status,
      is_active: l.students.is_active,
    }));

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

  useFocusEffect(
    useCallback(() => {
      loadChildren();
    }, [loadChildren])
  );

  // Load attendance whenever selected child changes
  const loadAttendance = useCallback(async () => {
    if (!selectedChildId) return;
    const myLoadId = ++loadIdRef.current;
    const fresh = () => myLoadId === loadIdRef.current;
    setLoadingRecords(true);

    const { data } = await supabase
      .from("attendance")
      .select(`
        id,
        status,
        lesson_sessions(
          session_date,
          classes(title)
        )
      `)
      .eq("student_id", selectedChildId);

    const mapped: AttendanceRecord[] = (data ?? [])
      .map((a: any) => ({
        id: a.id,
        status: a.status as DbStatus,
        session_date: a.lesson_sessions?.session_date ?? "",
        class_title: a.lesson_sessions?.classes?.title ?? "Class",
      }))
      .sort((a: AttendanceRecord, b: AttendanceRecord) =>
        b.session_date.localeCompare(a.session_date)
      );

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
    const { data: enrolments } = await supabase
      .from("student_class_enrolments")
      .select("enrolled_at, classes(id, day_of_week, title, start_time, end_time)")
      .eq("student_id", selectedChildId)
      .eq("is_active", true);

    const today = todayInSg();
    const horizon = addDays(today, UPCOMING_HORIZON_DAYS);
    const activeClasses = (enrolments ?? []).map((enr: any) => ({
      enr,
      cls: Array.isArray(enr.classes) ? enr.classes[0] : enr.classes,
    }));

    if (!fresh()) return;
    setHasExpectedLesson(
      activeClasses.some(({ enr, cls }) => {
        const day = cls?.day_of_week as DayOfWeek | undefined;
        return (
          !!day &&
          !!enr.enrolled_at &&
          expectedLessonDates(day, toSgDate(enr.enrolled_at), today).length > 0
        );
      })
    );

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
    ] = await Promise.all([
      supabase
        .from("tenant_public_holidays")
        .select("holiday_date")
        .gte("holiday_date", today)
        .lte("holiday_date", horizon),
      supabase
        .from("makeup_bookings")
        .select(
          "id, session_date, classes!makeup_bookings_class_id_fkey(id, title, start_time, end_time)"
        )
        .eq("student_id", selectedChildId)
        .is("cancelled_at", null)
        .gte("session_date", today)
        .lte("session_date", horizon),
      activeClassIds.length
        ? supabase
            .from("lesson_sessions")
            .select("class_id, session_date, start_time, end_time, classes(title)")
            .not("off_schedule_reason", "is", null)
            .neq("status", "cancelled")
            .in("class_id", activeClassIds)
            .gte("session_date", today)
            .lte("session_date", horizon)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (!fresh()) return;

    if (makeupErr) console.warn("upcoming: make-up read failed", makeupErr.message);
    if (extraErr) console.warn("upcoming: extra-lesson read failed", extraErr.message);

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

    const enrolmentInputs = activeClasses
      .filter(({ cls }) => cls?.day_of_week && cls?.title)
      .map(({ cls }, i) => ({
        class_id: (cls.id as string) ?? `enr-${i}`,
        day_of_week: cls.day_of_week as DayOfWeek,
        class_title: cls.title as string,
        time_label: timeLabel(cls.start_time ?? null, cls.end_time ?? null),
      }));

    const makeupInputs = (makeupRows ?? []).map((m: any) => {
      const c = Array.isArray(m.classes) ? m.classes[0] : m.classes;
      return {
        // Fall back to the booking id (never null) rather than a shared literal,
        // so two same-date make-ups with an unreadable host class do not collapse
        // to one dedup key.
        class_id: (c?.id as string) ?? `makeup:${m.id}`,
        class_title: (c?.title as string) ?? "another class",
        session_date: m.session_date as string,
        time_label: timeLabel(c?.start_time ?? null, c?.end_time ?? null),
      };
    });

    const extraInputs = (extraRows ?? []).map((s: any) => {
      const c = Array.isArray(s.classes) ? s.classes[0] : s.classes;
      return {
        class_id: s.class_id as string,
        class_title: (c?.title as string) ?? "Extra lesson",
        session_date: s.session_date as string,
        time_label: timeLabel(s.start_time ?? null, s.end_time ?? null),
      };
    });

    setUpcoming(
      computeUpcomingLessons(enrolmentInputs, today, holidays, makeupInputs, extraInputs)
    );

    setLoadingRecords(false);
  }, [selectedChildId]);

  useFocusEffect(
    useCallback(() => {
      loadAttendance();
    }, [loadAttendance])
  );

  const selectedChild = children.find((c) => c.id === selectedChildId) ?? null;
  const filtered = records.filter((r) => matchesFilter(r.status, filter));

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="px-5 pt-5 pb-3">
        <Text className="text-2xl font-bold text-gray-900">Attendance</Text>
        <Text className="text-sm text-gray-500 mt-0.5">
          Upcoming lessons and history for your children
        </Text>
      </View>

      {/* Child selector */}
      {loadingChildren ? (
        <View className="px-5 mb-3">
          <ActivityIndicator size="small" color="#0ea5e9" />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // flex-grow-0: react-native-web gives every ScrollView flexGrow:1, so a
          // horizontal one expands to fill the column's leftover height. items-start:
          // the row content container would otherwise stretch each chip to that
          // height (RN's default alignItems is stretch). Together they keep the
          // chips their natural size on web; native was never affected.
          className="flex-grow-0"
          contentContainerClassName="px-5 gap-2 mb-3 items-start"
        >
          {children.map((child) => (
            <TouchableOpacity
              key={child.id}
              onPress={() => setSelectedChildId(child.id)}
              className={`px-4 py-2 rounded-full border ${
                selectedChildId === child.id
                  ? "bg-sky-500 border-sky-500"
                  : "bg-white border-gray-200"
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  selectedChildId === child.id ? "text-white" : "text-gray-600"
                }`}
              >
                {child.full_name.split(" ")[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-grow-0"
        contentContainerClassName="px-5 gap-2 mb-4 items-start"
      >
        {FILTER_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt}
            onPress={() => setFilter(opt)}
            className={`px-3 py-1.5 rounded-full border ${
              filter === opt
                ? "bg-gray-900 border-gray-900"
                : "bg-white border-gray-200"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                filter === opt ? "text-white" : "text-gray-500"
              }`}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Attendance list */}
      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-2"
        showsVerticalScrollIndicator={false}
      >
        {/* Upcoming lessons — derived, shown above the marked history and outside
            the status filter (it applies only to what has already happened). */}
        {!loadingRecords &&
          selectedChild?.assignment_status === "assigned" &&
          upcoming.length > 0 && (
            <View className="mb-1">
              <Text className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
                Upcoming
              </Text>
              {upcoming.map((u) => (
                <Card key={u.key} className="flex-row items-center gap-3 mb-2">
                  <Ionicons name="calendar-outline" size={24} color="#0ea5e9" />
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm font-semibold text-gray-800">
                        {u.class_title}
                      </Text>
                      {u.kind !== "class" && (
                        <View
                          className={`px-2 py-0.5 rounded-full ${
                            u.kind === "makeup" ? "bg-emerald-100" : "bg-violet-100"
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-bold uppercase tracking-wide ${
                              u.kind === "makeup" ? "text-emerald-700" : "text-violet-700"
                            }`}
                          >
                            {u.kind === "makeup" ? "Make-up" : "Extra lesson"}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-xs text-gray-500">
                      {formatSgDate(u.session_date, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {u.time_label ? ` · ${u.time_label}` : ""}
                    </Text>
                  </View>
                </Card>
              ))}
              {records.length > 0 && (
                <Text className="text-xs font-bold uppercase tracking-wide text-gray-400 mt-3 mb-2">
                  History
                </Text>
              )}
            </View>
          )}

        {loadingRecords ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : children.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="people-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3">No children added yet</Text>
          </View>
        ) : selectedChild?.assignment_status === "unassigned" ? (
          // PRD §5.1: before assignment the attendance section shows a
          // "not assigned yet" state — not an empty list, which reads as broken.
          <View className="items-center py-16 px-4">
            <Ionicons name="hourglass-outline" size={40} color="#fcd34d" />
            <Text className="text-gray-500 font-semibold mt-3">
              {selectedChild.full_name.split(" ")[0]} isn&apos;t in a class yet
            </Text>
            <Text className="text-sm text-gray-400 mt-1 text-center">
              Not yet assigned to a class. The admin will assign your child soon.
              Lessons will show up here once that&apos;s done.
            </Text>
          </View>
        ) : records.length === 0 ? (
          hasExpectedLesson ? (
            // A lesson has already fallen due but nothing is recorded — the ball
            // is in the coach's court.
            <View className="items-center py-16 px-4">
              <Ionicons name="calendar-outline" size={40} color="#d1d5db" />
              <Text className="text-gray-400 mt-3 text-center">
                No lessons marked yet
              </Text>
              <Text className="text-xs text-gray-400 mt-1 text-center">
                Lessons appear here once the coach marks attendance.
              </Text>
            </View>
          ) : (
            // No lesson has happened since this child joined — nothing is late,
            // so don't imply the coach is behind.
            <View className="items-center py-16 px-4">
              <Ionicons name="hourglass-outline" size={40} color="#7dd3fc" />
              <Text className="text-gray-500 font-semibold mt-3 text-center">
                No lessons have taken place yet
              </Text>
              <Text className="text-sm text-gray-400 mt-1 text-center">
                {selectedChild?.full_name.split(" ")[0]} is in a class, but the first
                lesson hasn&apos;t happened yet. Attendance will appear here after it does.
              </Text>
            </View>
          )
        ) : filtered.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="funnel-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3">
              No {filter.toLowerCase()} lessons
            </Text>
          </View>
        ) : (
          filtered.map((item) => {
            const icon = STATUS_ICON[item.status];
            return (
              <Card key={item.id} className="flex-row items-center gap-3">
                <Ionicons
                  name={icon.name as any}
                  size={24}
                  color={icon.color}
                />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-gray-800">
                    {item.class_title}
                  </Text>
                  <Text className="text-xs text-gray-500">
                    {formatDate(item.session_date)}
                  </Text>
                </View>
                <Text className="text-xs font-medium text-gray-600 text-right max-w-[90px]">
                  {STATUS_LABEL[item.status]}
                </Text>
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
