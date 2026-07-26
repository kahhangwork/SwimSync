import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";
import { confirmAction } from "@/lib/confirm";
import { applyBulkStatus, SET_ALL_OPTIONS, BulkOption } from "@/lib/attendanceBulk";
import { mergeRoster } from "@/lib/attendanceRoster";
import { checkMarkableDate, type MarkableCheck } from "@/lib/attendanceWindow";
import {
  resolveSessionForDate,
  isShowingDate,
  type ResolvedSession,
} from "@/lib/attendanceSession";
import { toSgDate, todayInSg, type DayOfWeek } from "@/lib/lessonDates";
import PrimaryButton from "@/components/PrimaryButton";

type TopStatus = "unmarked" | "present" | "absent" | "cancelled" | "trial";
type DBStatus =
  | "present"
  | "absent"
  | "cancelled_rain"
  | "cancelled_coach"
  | "trial_paid"
  | "trial_free";

type StudentRow = {
  id: string;
  full_name: string;
  /** On this roster because of an attendance row or a trial booking, not an
   *  enrolment. */
  attendedOnly?: boolean;
  /** Booked for a trial on this date specifically. */
  isTrial?: boolean;
};

type AttState = {
  top: TopStatus;
  sub: string | null; // "rain"|"coach" for cancelled; "paid"|"free" for trial
  existingId: string | null;
};

function toDBStatus(top: TopStatus, sub: string | null): DBStatus | null {
  if (top === "unmarked") return null;
  if (top === "present") return "present";
  if (top === "absent") return "absent";
  if (top === "cancelled" && sub === "rain") return "cancelled_rain";
  if (top === "cancelled" && sub === "coach") return "cancelled_coach";
  if (top === "trial" && sub === "paid") return "trial_paid";
  if (top === "trial" && sub === "free") return "trial_free";
  return null;
}

function fromDBStatus(status: DBStatus): { top: TopStatus; sub: string | null } {
  switch (status) {
    case "present":         return { top: "present",   sub: null };
    case "absent":          return { top: "absent",    sub: null };
    case "cancelled_rain":  return { top: "cancelled", sub: "rain" };
    case "cancelled_coach": return { top: "cancelled", sub: "coach" };
    case "trial_paid":      return { top: "trial",     sub: "paid" };
    case "trial_free":      return { top: "trial",     sub: "free" };
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const TOP_STATUSES: {
  key: TopStatus;
  label: string;
  ring: string;
  bg: string;
}[] = [
  { key: "present",   label: "Present",   ring: "border-green-500",  bg: "bg-green-500"  },
  { key: "absent",    label: "Absent",    ring: "border-gray-400",   bg: "bg-gray-400"   },
  { key: "cancelled", label: "Cancelled", ring: "border-orange-500", bg: "bg-orange-500" },
  { key: "trial",     label: "Trial",     ring: "border-blue-500",   bg: "bg-blue-500"   },
];

export default function MarkAttendanceScreen() {
  const { id } = useLocalSearchParams<{
    id: string;
    date: string;
    sessionId?: string;
  }>();
  const { date, sessionId: sessionIdParam, from } = useLocalSearchParams<{
    date: string;
    sessionId?: string;
    from?: string;
  }>();

  // ── WHERE DOES LEAVING THIS SCREEN GO? ──────────────────────────────────
  // Not `router.back()`, which trusts whatever happens to be underneath — and
  // what is underneath is frequently ANOTHER LESSON'S attendance screen.
  //
  // This screen lives in the CLASSES tab's Stack (classes/_layout.tsx) but is
  // pushed from the TODAY tab as well. Switching tabs does not unwind the
  // Classes stack, it only hides it, so the stack accumulates:
  //
  //   Today → tap 845am card       [classes-index, att(845, 26 Jul)]
  //   back chevron → Today         [classes-index, att(845, 26 Jul)]  ← kept
  //   Today → tap 930am card       [classes-index, att(845,26), att(930,26)]
  //   Save → router.back()         → lands on att(845, 26 Jul)
  //
  // Which is what the coach reported: saving the 9:30 class returned them to
  // the 8:45 one, and the URL still carried the 8:45 session id.
  //
  // So the caller says where it came from and we go there EXPLICITLY, with
  // `replace` rather than `push` — that also drops this screen out of the
  // history, so nothing can pop back into a lesson the coach has finished.
  const exitHref =
    from === "roster" ? `/(coach)/classes/${id}/roster` : "/(coach)/today";

  function leaveScreen() {
    router.replace(exitHref as any);
  }

  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);

  const [classTitle, setClassTitle] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttState>>({});
  // A session id is never held on its own — always with the date it belongs
  // to. See lib/attendanceSession.ts for what that prevents.
  const [resolved, setResolved] = useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Non-null when this date may not be marked. The database refuses it anyway;
  // this is so the coach is told why, before filling in a roster that cannot
  // be saved.
  const [blocked, setBlocked] = useState<MarkableCheck | null>(null);
  // Which load() is the current one. Switching lessons quickly can leave an
  // earlier fetch in flight; without this it lands last and repopulates the
  // screen with the lesson the coach navigated AWAY from.
  const loadToken = useRef(0);

  // ⚠ THESE DEPS ARE LOAD-BEARING — this was `[]`, and it wrote attendance to
  // the wrong day (§7.62). One route serves every lesson, distinguished only
  // by `?date=`, and Expo Router reuses the mounted screen when a search param
  // changes. A mount-only effect therefore never reloads, so the header showed
  // the new lesson over the previous lesson's roster and session id.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, date, sessionIdParam]);

  async function load() {
    const token = ++loadToken.current;
    setLoading(true);

    // Clear everything the PREVIOUS lesson put here before fetching. Leaving
    // it in place is what let a stale roster be displayed, filled in and
    // saved; `resolved` going null is also what holds the spinner up (below)
    // until this date's data has actually arrived.
    setResolved(null);
    setBlocked(null);
    setStudents([]);
    setAttendance({});

    // Load class title + the students enrolled ON THIS DATE
    const { data: cls } = await supabase
      .from("classes")
      .select(`
        title,
        day_of_week,
        student_class_enrolments(
          is_active,
          enrolled_at,
          unenrolled_at,
          students(id, full_name)
        )
      `)
      .eq("id", id)
      .single();

    if (token !== loadToken.current) return;

    if (!cls) {
      // Not reachable from ordinary navigation, but an RLS denial looks like
      // this. Say so rather than leaving the spinner up forever — the render
      // guard below now keys off `resolved`, which this path never sets.
      setBlocked({
        ok: false,
        title: "That class could not be loaded",
        detail: "Go back and try again, or ask your admin to check the class.",
      });
      setResolved({ date, sessionId: null });
      setLoading(false);
      return;
    }

    setClassTitle(cls.title);

    // ── THE ROSTER FOR A DATE IS THE ROSTER AS IT WAS ON THAT DATE ──────────
    // This used to filter on `is_active` alone, with no reference to `date` at
    // all — so opening any past lesson showed TODAY'S roster. A child who
    // joined last month appeared on a lesson from before they existed here,
    // and because the save refuses until every student on screen has a status,
    // the coach was FORCED to record attendance for a child who was not there.
    //
    // Both ends inclusive, matching EnrolmentSpan: a trial walk-in's enrolment
    // opens and closes on its own date, and an exclusive end would drop them
    // from the very screen that is marking them.
    const enrolledOnDate: StudentRow[] = (cls.student_class_enrolments ?? [])
      .filter((e: any) => {
        const from = toSgDate(e.enrolled_at);
        const until = e.unenrolled_at ? toSgDate(e.unenrolled_at) : null;
        return from <= date && (until === null || date <= until);
      })
      .map((e: any) => ({
        id: e.students.id,
        full_name: e.students.full_name,
      }));

    // Resolve session id — use param, or look up existing, or leave null (create on save)
    let sid = sessionIdParam ?? null;
    if (!sid) {
      const { data: existingSession } = await supabase
        .from("lesson_sessions")
        .select("id")
        .eq("class_id", id)
        .eq("session_date", date)
        .maybeSingle();
      sid = existingSession?.id ?? null;
    }

    if (token !== loadToken.current) return;

    // Stamped with the date it was resolved FOR, so nothing downstream can
    // mistake it for this screen's current lesson after a param change.
    setResolved({ date, sessionId: sid });

    // ── Is this date markable at all? ──────────────────────────────────────
    // Checked AFTER the session lookup, because an existing session is itself
    // the authorisation: an off-schedule lesson the admin scheduled is not on
    // the class's weekday and must still be markable.
    const check = checkMarkableDate({
      date,
      today: todayInSg(),
      classDayOfWeek: cls.day_of_week as DayOfWeek,
      classTitle: cls.title,
      sessionExists: sid !== null,
    });
    if (!check.ok) {
      setBlocked(check);
      setLoading(false);
      return;
    }
    setBlocked(null);

    // Attendance is fetched BEFORE the roster is set, because it partly
    // DEFINES the roster: a trial walk-in's enrolment closes on its own date,
    // so they are not actively enrolled and would otherwise disappear from the
    // screen that just marked them. See lib/attendanceRoster.ts.
    const { data: attData } = sid
      ? await supabase
          .from("attendance")
          .select("id, student_id, status, students(id, full_name)")
          .eq("lesson_session_id", sid)
      : { data: [] as any[] };

    // Children booked for a TRIAL on this date. They are not enrolled — a trial
    // is a visit, not a standing arrangement — so without this they would never
    // appear, never be marked, and the billing month could never close.
    const { data: booked } = await supabase
      .from("trial_bookings")
      .select("student_id, students(id, full_name)")
      .eq("class_id", id)
      .eq("session_date", date)
      .is("cancelled_at", null);

    if (token !== loadToken.current) return;

    const roster = mergeRoster(
      enrolledOnDate,
      (attData ?? [])
        .map((a: any) => a.students)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, full_name: s.full_name })),
      (booked ?? [])
        .map((b: any) => b.students)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, full_name: s.full_name }))
    );

    setStudents(roster);

    // Pre-fill attendance from existing records (or default to present)
    const initAtt: Record<string, AttState> = {};
    if (sid) {
      for (const student of roster) {
        const existing = (attData ?? []).find(
          (a: any) => a.student_id === student.id
        );
        if (existing) {
          const parsed = fromDBStatus(existing.status as DBStatus);
          initAtt[student.id] = {
            top: parsed.top,
            sub: parsed.sub,
            existingId: existing.id,
          };
        } else {
          initAtt[student.id] = { top: "unmarked", sub: null, existingId: null };
        }
      }
    } else {
      for (const student of roster) {
        initAtt[student.id] = { top: "unmarked", sub: null, existingId: null };
      }
    }

    setAttendance(initAtt);
    setLoading(false);
  }

  function setTop(studentId: string, top: TopStatus) {
    setAttendance((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], top, sub: null },
    }));
  }

  function setSub(studentId: string, sub: string) {
    setAttendance((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], sub },
    }));
  }

  function onSetAll(opt: BulkOption) {
    setMenuOpen(false);
    const apply = () => {
      setAttendance((prev) =>
        applyBulkStatus(
          students.map((s) => s.id),
          prev,
          { top: opt.top, sub: opt.sub }
        )
      );
      showToast(`All ${students.length} set to ${opt.label}.`, "info");
    };
    const anyMarked = students.some(
      (s) => (attendance[s.id]?.top ?? "unmarked") !== "unmarked"
    );
    if (anyMarked) {
      confirmAction(
        `Set all to ${opt.label}?`,
        `This will change all ${students.length} students to ${opt.label}.`,
        apply,
        "Set all"
      );
    } else {
      apply();
    }
  }

  async function handleSave() {
    // Validate all statuses are complete
    for (const student of students) {
      const state = attendance[student.id];
      if (!state || state.top === "unmarked") {
        showToast(`Please mark attendance for ${student.full_name}.`, "error");
        return;
      }
      if (toDBStatus(state.top, state.sub) === null) {
        showToast(
          `Please select a sub-type for ${student.full_name}.`,
          "error"
        );
        return;
      }
    }

    setSaving(true);

    // Get coach record
    const { data: coach } = await supabase
      .from("coaches")
      .select("id")
      .eq("profile_id", session!.id)
      .single();

    if (!coach) {
      showToast("Could not find coach record.", "error");
      setSaving(false);
      return;
    }

    // ── WHICH LESSON AM I WRITING TO? ──────────────────────────────────────
    // Never the bare id this screen happens to be holding. It is only usable
    // if it was resolved for the date now on screen; anything else is treated
    // as unknown and re-resolved from (class_id, date) — the pair that
    // uniquely identifies a lesson. This is the layer that would have caught
    // §7.62 even with the mount-only effect still in place.
    const decision = resolveSessionForDate(resolved, date);
    let finalSessionId =
      decision.kind === "use" ? decision.sessionId : null;

    if (decision.kind === "stale") {
      const { data: existingSession } = await supabase
        .from("lesson_sessions")
        .select("id")
        .eq("class_id", id)
        .eq("session_date", date)
        .maybeSingle();
      finalSessionId = existingSession?.id ?? null;
    }

    if (!finalSessionId) {
      const { data: newSession, error: sessionError } = await supabase
        .from("lesson_sessions")
        .insert({ class_id: id, session_date: date, status: "scheduled" })
        .select("id")
        .single();

      if (sessionError || !newSession) {
        showToast("Could not create session record.", "error");
        setSaving(false);
        return;
      }

      finalSessionId = newSession.id;
    }

    setResolved({ date, sessionId: finalSessionId });

    // Build upsert rows
    const rows = students.map((student) => {
      const state = attendance[student.id];
      const dbStatus = toDBStatus(state.top, state.sub)!;
      return {
        ...(state.existingId ? { id: state.existingId } : {}),
        lesson_session_id: finalSessionId,
        student_id: student.id,
        status: dbStatus,
        marked_by: session!.id,
        last_edited_by: session!.id,
      };
    });

    const { error: upsertError } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "lesson_session_id,student_id" });

    if (upsertError) {
      showToast("Failed to save attendance. Please try again.", "error");
      setSaving(false);
      return;
    }

    // Audit log
    await supabase.from("audit_log").insert({
      actor_id: session!.id,
      action: "attendance_saved",
      entity_type: "lesson_session",
      entity_id: finalSessionId,
      new_value: {
        class_id: id,
        date,
        student_count: students.length,
      },
    });

    setSaving(false);
    showToast("Attendance saved.", "success");
    leaveScreen();
  }

  // The spinner also covers the gap between a param change and the reload
  // landing. The effect runs after paint, so without `isShowingDate` there is
  // a frame where the header names the new lesson above the previous one's
  // roster — and a tap is faster than a frame is long.
  if (loading || !isShowingDate(resolved, date)) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  // This date cannot be marked. Shown INSTEAD of the roster rather than as a
  // toast over it: a roster the coach can fill in but never save is worse than
  // no roster, and the reason belongs where the work would have happened.
  if (blocked && !blocked.ok) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50">
        <View className="flex-row items-center px-5 pt-4 pb-3">
          <TouchableOpacity onPress={() => leaveScreen()} className="mr-3">
            <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-bold text-gray-900">
              Mark Attendance
            </Text>
            <Text className="text-xs text-gray-500">
              {classTitle} · {formatDate(date)}
            </Text>
          </View>
        </View>

        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="lock-closed-outline" size={44} color="#cbd5e1" />
          <Text className="text-base font-bold text-gray-900 mt-3 text-center">
            {blocked.title}
          </Text>
          <Text className="text-sm text-gray-500 mt-2 text-center leading-5">
            {blocked.detail}
          </Text>
          <TouchableOpacity
            onPress={() => leaveScreen()}
            className="mt-6 px-5 py-3 rounded-xl bg-sky-500"
          >
            <Text className="text-white font-semibold">Back to class</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => leaveScreen()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">Mark Attendance</Text>
          <Text className="text-xs text-gray-500">
            {classTitle} · {formatDate(date)}
          </Text>
        </View>
        {students.length > 0 && (
          <TouchableOpacity
            onPress={() => setMenuOpen((v) => !v)}
            className="flex-row items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5"
          >
            <Text className="text-xs font-semibold text-sky-600">Set all</Text>
            <Ionicons
              name={menuOpen ? "chevron-up" : "chevron-down"}
              size={14}
              color="#0ea5e9"
            />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-3"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-sm text-gray-500 mb-1">
          Tap a status for each student
        </Text>

        {students.length === 0 ? (
          <View className="bg-white rounded-2xl p-6 items-center border border-gray-100">
            <Text className="text-gray-400 text-sm">No students enrolled</Text>
          </View>
        ) : (
          students.map((student) => {
            const state = attendance[student.id] ?? {
              top: "unmarked",
              sub: null,
              existingId: null,
            };
            return (
              <View
                key={student.id}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
              >
                {/* Student name */}
                <View className="flex-row items-center gap-3 mb-3">
                  <View className="w-9 h-9 rounded-full bg-sky-100 items-center justify-center">
                    <Text className="text-sky-600 font-bold text-sm">
                      {student.full_name.charAt(0)}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-gray-800">
                    {student.full_name}
                  </Text>
                  {student.attendedOnly && (
                    // Not a weekly regular — say which kind, because a TRIAL is
                    // someone the coach is meeting for the first time and the
                    // status they pick decides what the family is charged.
                    <View
                      className={`px-2 py-0.5 rounded-full ${
                        student.isTrial ? "bg-sky-100" : "bg-amber-100"
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-semibold ${
                          student.isTrial ? "text-sky-700" : "text-amber-700"
                        }`}
                      >
                        {student.isTrial ? "Trial" : "Not enrolled"}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Unmarked indicator */}
                {state.top === "unmarked" && (
                  <View className="flex-row items-center gap-1.5 mb-2">
                    <View className="w-2 h-2 rounded-full bg-gray-300" />
                    <Text className="text-xs text-gray-400 font-medium">
                      Not yet marked
                    </Text>
                  </View>
                )}

                {/* Top-level status buttons */}
                <View className="flex-row gap-2">
                  {TOP_STATUSES.map(({ key, label, ring, bg }) => {
                    const isSelected = state.top === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setTop(student.id, key)}
                        className={`flex-1 py-2 rounded-xl border-2 items-center ${
                          isSelected
                            ? `${ring} ${bg}`
                            : "border-gray-200 bg-gray-50"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            isSelected ? "text-white" : "text-gray-500"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Cancelled sub-type */}
                {state.top === "cancelled" && (
                  <View className="mt-3 flex-row gap-2 items-center">
                    <Text className="text-xs text-gray-500 mr-1">Reason:</Text>
                    {[
                      { key: "rain", label: "Rain" },
                      { key: "coach", label: "Coach" },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setSub(student.id, key)}
                        className={`px-4 py-1.5 rounded-full border ${
                          state.sub === key
                            ? "bg-orange-500 border-orange-500"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            state.sub === key ? "text-white" : "text-gray-600"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Trial sub-type */}
                {state.top === "trial" && (
                  <View className="mt-3 flex-row gap-2 items-center">
                    <Text className="text-xs text-gray-500 mr-1">Trial type:</Text>
                    {[
                      { key: "paid", label: "Paid" },
                      { key: "free", label: "Free" },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setSub(student.id, key)}
                        className={`px-4 py-1.5 rounded-full border ${
                          state.sub === key
                            ? "bg-blue-500 border-blue-500"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            state.sub === key ? "text-white" : "text-gray-600"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}

        <PrimaryButton
          label={saving ? "Saving…" : "Save Attendance"}
          onPress={handleSave}
          className="mt-2"
        />
      </ScrollView>

      {/* Set-all dropdown (rendered last so it stacks above the list) */}
      {menuOpen && (
        <>
          <Pressable
            onPress={() => setMenuOpen(false)}
            className="absolute left-0 right-0 top-0 bottom-0 z-40"
          />
          <View className="absolute right-5 top-14 z-50 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
            {SET_ALL_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => onSetAll(opt)}
                className={`flex-row items-center gap-2.5 px-4 py-3 ${
                  i > 0 ? "border-t border-gray-100" : ""
                }`}
              >
                <View className={`h-2.5 w-2.5 rounded-full ${opt.dot}`} />
                <Text className="text-sm text-gray-800">{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
