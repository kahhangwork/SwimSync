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
  expectedLessonDates,
  backlogWindowStart,
  toSgDate,
  formatSgDate,
  ageFromDob,
  type DayOfWeek,
} from "@/lib/lessonDates";
import { countMarked } from "@/lib/attendanceCompleteness";
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
  marked_count: number;
  total_count: number;
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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [markTarget, setMarkTarget] = useState<{
    date: string;
    sessionId: string | null;
  } | null>(null);
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
        location_name,
        student_class_enrolments(
          is_active,
          enrolled_at,
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
      location_name: cls.location_name,
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

    // Load all past sessions for this class (up to today)
    const { data: sessionData } = await supabase
      .from("lesson_sessions")
      .select(`
        id,
        session_date,
        attendance(id, student_id)
      `)
      .eq("class_id", id)
      .lte("session_date", todayDate)
      .order("session_date", { ascending: false });

    const totalStudents = activeStudents.length;
    const activeStudentIds = activeStudents.map((s) => s.id);

    const rows: Session[] = (sessionData ?? []).map((s: any) => {
      const markedIds = new Set<string>(
        (s.attendance ?? []).map((a: any) => a.student_id)
      );
      return {
        id: s.id,
        session_date: s.session_date,
        // Counts only students still enrolled — the shared completeness rule,
        // not the raw attendance row count.
        marked_count: countMarked(activeStudentIds, markedIds),
        total_count: totalStudents,
      };
    });

    // Merge in lessons that should have happened but were never marked — those
    // have no session row, so querying lesson_sessions alone renders nothing and
    // the screen would imply the class is fully up to date.
    //
    // The window floor is max(start of last month, earliest enrolment): the coach
    // can mark back to there but no further — older lessons sit behind a generated
    // invoice and need a credit note, not a late mark. The same window bounds the
    // "Mark Attendance" target below.
    const enrolments = (cls.student_class_enrolments ?? []) as any[];
    let winStart: string | null = null;
    let target: { date: string; sessionId: string | null } | null = null;

    if (activeStudentIds.length > 0) {
      const earliest = enrolments.map((e) => toSgDate(e.enrolled_at)).sort()[0];
      winStart = backlogWindowStart(todayDate, earliest ?? null);

      const expected = expectedLessonDates(
        cls.day_of_week as DayOfWeek,
        winStart,
        todayDate
      );

      // Primary action targets the most recent expected lesson in the window:
      // today if today is a class day, else the last class day that has passed.
      // No expected lesson yet = nothing has fallen due since the class started.
      if (expected.length > 0) {
        const date = expected[expected.length - 1];
        const sessId =
          (sessionData ?? []).find((s: any) => s.session_date === date)?.id ?? null;
        target = { date, sessionId: sessId };
      }

      const seen = new Set(rows.map((r) => r.session_date));
      for (const date of expected) {
        if (seen.has(date)) continue;
        rows.push({
          id: null,
          session_date: date,
          marked_count: 0,
          total_count: totalStudents,
        });
      }
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

  const isComplete = (s: Session) => s.marked_count >= s.total_count && s.total_count > 0;

  // Removing a student closes their enrolment; it never deletes anything.
  // Their past attendance still bills (the invoice engine reads attendance
  // rows, not current enrolment), and they drop out of the completeness check
  // so a child who has stopped coming can no longer block invoicing.
  // confirmAction, not Alert.alert — Alert is a no-op on the web build.
  const handleRemove = (student: Student) => {
    confirmAction(
      "Remove from class?",
      `${student.full_name} will be removed from this class and returned to the admin's unassigned list. Lessons they have already attended are still billed, and their history is kept.`,
      async () => {
        setRemovingId(student.id);
        const { error } = await removeFromClass(supabase, student.id);
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
                    `/(coach)/classes/${id}/attendance?date=${markTarget.date}` +
                      (markTarget.sessionId
                        ? `&sessionId=${markTarget.sessionId}`
                        : "")
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
              const complete = isComplete(session);
              const unmarked = session.id === null;
              return (
                <TouchableOpacity
                  key={session.session_date}
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${id}/attendance?date=${session.session_date}` +
                        (session.id ? `&sessionId=${session.id}` : "")
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Card
                    className={`flex-row items-center gap-3 ${
                      unmarked ? "border-orange-200 bg-orange-50" : ""
                    }`}
                  >
                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center ${
                        complete ? "bg-green-100" : "bg-orange-100"
                      }`}
                    >
                      <Ionicons
                        name={complete ? "checkmark" : "alert"}
                        size={18}
                        color={complete ? "#16a34a" : "#ea580c"}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-gray-800">
                        {formatDate(session.session_date)}
                      </Text>
                      <Text
                        className={`text-xs ${
                          complete ? "text-green-600" : "text-orange-500"
                        }`}
                      >
                        {complete
                          ? "All attendance marked"
                          : unmarked
                          ? "Not marked"
                          : `${session.marked_count}/${session.total_count} marked`}
                      </Text>
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
