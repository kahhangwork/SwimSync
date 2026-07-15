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
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";

type TodayClass = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  location_name: string;
  student_count: number;
  session_id: string | null; // null if no lesson session generated for today yet
};

/** A past lesson that should have happened but has no complete attendance. */
type BacklogItem = {
  class_id: string;
  class_title: string;
  date: string;
  session_id: string | null; // non-null when the session exists but is partial
};

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function isNowInRange(start: string, end: string): boolean {
  const now = new Date();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= sh * 60 + sm && nowMins <= eh * 60 + em;
}

export default function TodayScreen() {
  const session = useAppStore((s) => s.session);
  const [classes, setClasses] = useState<TodayClass[]>([]);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [outstandingCount, setOutstandingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Everything below derives from this one date string, so the weekday we query
  // by can never disagree with the date we write attendance to.
  const todayDate = todayInSg();
  const todayDayOfWeek = dayOfWeekOf(todayDate);
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
        student_class_enrolments(student_id, is_active, enrolled_at)
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
          .select("id, class_id, session_date, attendance(student_id)")
          .in("class_id", classIds)
          .gte("session_date", windowStart)
          .lte("session_date", todayDate)
      : { data: [] };

    // key: "<class_id>:<session_date>"
    const sessionByClassDate = new Map<
      string,
      { id: string; markedStudentIds: Set<string> }
    >();
    (windowSessions ?? []).forEach((s: any) => {
      sessionByClassDate.set(`${s.class_id}:${s.session_date}`, {
        id: s.id,
        markedStudentIds: new Set(
          (s.attendance ?? []).map((a: any) => a.student_id)
        ),
      });
    });

    const mapped: TodayClass[] = coachClasses
      .filter((cls: any) => cls.day_of_week === todayDayOfWeek)
      .map((cls: any) => ({
        id: cls.id,
        title: cls.title,
        start_time: cls.start_time,
        end_time: cls.end_time,
        location_name: cls.location_name,
        student_count: (cls.student_class_enrolments ?? []).filter(
          (e: any) => e.is_active
        ).length,
        session_id:
          sessionByClassDate.get(`${cls.id}:${todayDate}`)?.id ?? null,
      }));

    setClasses(mapped);

    // Lessons that should have happened but aren't fully marked. A lesson is
    // only "marked" once every active student has an attendance row — the same
    // rule the invoice engine's completeness gate uses.
    const items: BacklogItem[] = [];
    for (const cls of coachClasses as any[]) {
      const enrolments = cls.student_class_enrolments ?? [];
      const activeStudentIds = enrolments
        .filter((e: any) => e.is_active)
        .map((e: any) => e.student_id);
      if (activeStudentIds.length === 0) continue;

      // Bound by the earliest enrolment (active or not) so we never ask about
      // lessons from before the class had anyone in it.
      const earliest = enrolments
        .map((e: any) => toSgDate(e.enrolled_at))
        .sort()[0];
      const from = backlogWindowStart(todayDate, earliest ?? null);

      for (const date of expectedLessonDates(
        cls.day_of_week as DayOfWeek,
        from,
        todayDate
      )) {
        if (date === todayDate) continue; // today already has its own card
        const sess = sessionByClassDate.get(`${cls.id}:${date}`);
        const fullyMarked =
          !!sess &&
          activeStudentIds.every((id: string) => sess.markedStudentIds.has(id));
        if (!fullyMarked) {
          items.push({
            class_id: cls.id,
            class_title: cls.title,
            date,
            session_id: sess?.id ?? null,
          });
        }
      }
    }
    items.sort((a, b) => b.date.localeCompare(a.date)); // most recent first
    setBacklog(items);

    // Count outstanding invoices for students in this coach's classes
    const { count } = await supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("status", "outstanding")
      .in(
        "parent_id",
        // Subquery: get all parent_ids for students enrolled in this coach's classes
        (
          await supabase
            .from("student_class_enrolments")
            .select("students(parent_students(parent_id))")
            .in("class_id", classIds)
            .eq("is_active", true)
        ).data
          ?.flatMap((e: any) =>
            e.students?.parent_students?.map((ps: any) => ps.parent_id) ?? []
          ) ?? []
      );

    setOutstandingCount(count ?? 0);
    setLoading(false);
  }, [session, todayDayOfWeek, todayDate]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const totalStudents = classes.reduce((s, c) => s + c.student_count, 0);

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
          <View className="flex-1 bg-white rounded-2xl p-4 shadow-sm border border-gray-100 items-center">
            <Text className="text-2xl font-bold text-red-500">
              {loading ? "—" : outstandingCount}
            </Text>
            <Text className="text-xs text-gray-500 mt-0.5 text-center">
              Outstanding
            </Text>
          </View>
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
                      `/(coach)/classes/${item.class_id}/attendance?date=${item.date}` +
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
              const isActive = isNowInRange(cls.start_time, cls.end_time);
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
                    <View className="bg-sky-100 rounded-full px-3 py-1">
                      <Text className="text-xs font-semibold text-sky-700">
                        {cls.student_count} students
                      </Text>
                    </View>
                  </View>

                  <PrimaryButton
                    label="Mark Attendance"
                    onPress={() =>
                      router.push(
                        `/(coach)/classes/${cls.id}/attendance?date=${todayDate}${cls.session_id ? `&sessionId=${cls.session_id}` : ""}`
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
