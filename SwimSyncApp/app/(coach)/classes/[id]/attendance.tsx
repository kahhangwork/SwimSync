import React, { useState, useEffect } from "react";
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
import { buildAttendanceRows } from "@/lib/attendancePayload";
import { attendanceSaveErrorMessage } from "@/lib/attendanceSaveError";
import {
  resolveSessionForDate,
  isShowingDate,
} from "@/lib/attendanceSession";
import {
  canMark,
  roleNotice,
} from "@/lib/coachRoster";
import {
  mayHaveIssuedCreditNote,
  notifyCreditNoteEmails,
} from "@/lib/creditNoteEmail";
import PrimaryButton from "@/components/PrimaryButton";
import type { TopStatus } from "@/features/mark-attendance/types";
import { TOP_STATUSES } from "@/features/mark-attendance/constants";
import { formatDate, toDBStatus } from "@/features/mark-attendance/domain/attendanceStatus";
import { useAttendanceLoad } from "@/features/mark-attendance/domain/useAttendanceLoad";
import { exitHrefOf } from "@/features/mark-attendance/domain/exitHref";

export default function MarkAttendanceScreen() {
  const { id } = useLocalSearchParams<{
    id: string;
    date: string;
  }>();
  // ⚠ THERE IS DELIBERATELY NO `sessionId` PARAM ANY MORE. This screen used to
  // accept one from the URL and trust it, without checking that it belonged to
  // this class or to the date on screen. Supplying a real session id satisfied
  // the "this session already exists" branch, which SKIPS the weekday check —
  // so the screen rendered a markable roster for a date it should have refused.
  // Never a billing hole (records attach to the session that id names, and the
  // database guard reads that session's OWN date, so every write stayed inside
  // the window), but the header could show a date the records did not belong
  // to. The session is now always resolved from `(class_id, date)`, which is
  // UNIQUE — `lesson_sessions` carries `ON CONFLICT (class_id, session_date)`
  // (20260727000100) — so the lookup cannot disagree with what a caller would
  // have passed, and there is nothing left to trust.
  const { date, from } = useLocalSearchParams<{
    date: string;
    from?: string;
  }>();

  // Where leaving goes — the §7.65 rule and its ⚠ default-arm note live with
  // exitHrefOf (features/mark-attendance/domain/exitHref.ts).
  const exitHref = exitHrefOf(from, id);

  function leaveScreen() {
    router.replace(exitHref as any);
  }

  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);

  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    classTitle,
    students,
    attendance,
    setAttendance,
    loadedStatuses,
    resolved,
    setResolved,
    loading,
    blocked,
    shadowsHere,
    setShadowsHere,
    role,
    load,
  } = useAttendanceLoad(id, date);

  // ⚠ THESE DEPS ARE LOAD-BEARING — this was `[]`, and it wrote attendance to
  // the wrong day (§7.64). One route serves every lesson, distinguished only
  // by `?date=`, and Expo Router reuses the mounted screen when a search param
  // changes. A mount-only effect therefore never reloads, so the header showed
  // the new lesson over the previous lesson's roster and session id.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, date]);

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
          // Never re-mark a holiday row — the guard refuses a coach clearing one,
          // and a single refused row fails the whole batch save (§7.67).
          students.filter((s) => prev[s.id]?.top !== "holiday").map((s) => s.id),
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
      // A holiday row is admin-owned and read-only here — it needs no marking and
      // is left out of the save payload below, so don't demand a status for it.
      if (state?.top === "holiday") continue;
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
    // §7.64 even with the mount-only effect still in place.
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

    // A real guard rather than `!`: everything below writes attendance against
    // this id, and a null here would be the §7.64 class of mistake again.
    if (!finalSessionId) {
      showToast("Could not create session record.", "error");
      setSaving(false);
      return;
    }

    setResolved({ date, sessionId: finalSessionId });

    // Built in lib/attendancePayload.ts, NOT inline — every row has to carry
    // the same keys or PostgREST inserts NULL for the ones a row omits (§7.67).
    // That is what made a partially-marked lesson permanently unsaveable.
    const rows = buildAttendanceRows(
      finalSessionId,
      session!.id,
      students
        // EXCLUDE holiday rows: the DB guard refuses a coach writing 'holiday', and
        // one refused row rolls back the whole batch upsert (§7.67). Leaving them
        // out of the payload keeps the admin's void untouched by a coach save.
        .filter((student) => attendance[student.id].top !== "holiday")
        .map((student) => ({
          studentId: student.id,
          status: toDBStatus(
            attendance[student.id].top,
            attendance[student.id].sub
          )!,
        }))
    );

    const { error: upsertError } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "lesson_session_id,student_id" });

    if (upsertError) {
      // ⚠ CN001 — the credit-note trigger REFUSED to un-correct a lesson whose
      // credit is already applied (20260818000100). One row in a batch upsert, so
      // the whole roster rolled back — attendanceSaveErrorMessage says so.
      showToast(
        attendanceSaveErrorMessage((upsertError as { code?: string }).code),
        "error"
      );
      setSaving(false);
      return;
    }

    // ── Coaches present ───────────────────────────────────────────────────
    // ⚠ AFTER THE ATTENDANCE UPSERT, AND ON finalSessionId. The lesson_sessions
    // row is created LAZILY above, so an absence written before it has no lesson
    // to reference.
    //
    // ⚠ A ROW MEANS ABSENT. No row means the shadow was here and is paid, which
    // is why a FAILED write here is survivable: it leaves them PAID, the
    // recoverable direction. Inverting this to a presence record would trade
    // that for a silent underpayment (migration §2).
    //
    // Alert.alert is a no-op on RN-web, so the failure is a Toast.
    if (shadowsHere.length > 0) {
      const absent = shadowsHere.filter((sh) => !sh.present);
      const present = shadowsHere.filter((sh) => sh.present);

      const [delRes, insRes] = await Promise.all([
        present.length > 0
          ? supabase
              .from("session_coach_absences")
              .delete()
              .eq("lesson_session_id", finalSessionId)
              .in("coach_id", present.map((sh) => sh.coach_id))
          : Promise.resolve({ error: null }),
        absent.length > 0
          ? supabase.from("session_coach_absences").upsert(
              absent.map((sh) => ({
                lesson_session_id: finalSessionId,
                coach_id: sh.coach_id,
                // Stamped by the trigger; the value sent is never trusted.
                tenant_id: "00000000-0000-0000-0000-000000000000",
                marked_by: session!.id,
              })),
              { onConflict: "lesson_session_id,coach_id" }
            )
          : Promise.resolve({ error: null }),
      ]);

      if (delRes.error || insRes.error) {
        // Named, not swallowed: the month may be settled, in which case the
        // seal refused this deliberately and the attendance above still saved.
        showToast(
          `Attendance saved, but the coaches-present list did not: ${
            (delRes.error ?? insRes.error)?.message ?? "unknown error"
          }`,
          "error"
        );
      }
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

    // ⚠ RISK 9 (CREDIT_NOTE_EMAIL_PLAN.md) — BEFORE setSaving(false), and before
    // leaveScreen(). If this attendance edit flipped an already-invoiced lesson from
    // billable to non-billable, the handle_attendance_update trigger has just issued
    // a credit note, and the parent has no idea until they open the app.
    //
    // AWAITED ON PURPOSE, bounded to 3s. leaveScreen() below is a router.replace
    // that unmounts this screen, so an unawaited request is issued milliseconds
    // before its own destruction — and a coach who locks the phone kills it. Held
    // here, the existing save spinner covers the wait; the attendance rows are
    // already committed above, so this can only delay the toast, never the save.
    // Silent on failure by decision: the admin's Credit Notes page has the Resend
    // button, and a failed email is not something the coach can act on (§8.27).
    //
    // GUARDED so the COMMON save pays nothing. A credit note can only arise when a
    // lesson LEAVES 'present'/'trial_paid'; every other save — the normal one — would
    // otherwise wait on an edge-function cold start plus five queries to be told there
    // was nothing to do. The server stays authoritative; this only skips the call when
    // a note is impossible.
    const savedStatuses = Object.fromEntries(
      rows.map((r) => [r.student_id, r.status as string | null])
    );
    if (mayHaveIssuedCreditNote(loadedStatuses.current, savedStatuses)) {
      await notifyCreditNoteEmails(supabase, finalSessionId);
    }

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

  // A lesson I am shadowing, or one another coach was rostered to cover, is
  // READ-ONLY here — the database refuses my write either way. The roster still
  // renders: a trainee is on the poolside to learn who is expected, and a coach
  // whose lesson was covered is entitled to see what happened in their class.
  const readOnly = !canMark(role);
  const notice = roleNotice(role);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => leaveScreen()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {readOnly ? "Lesson Attendance" : "Mark Attendance"}
          </Text>
          <Text className="text-xs text-gray-500">
            {classTitle} · {formatDate(date)}
          </Text>
        </View>
        {students.length > 0 && !readOnly && (
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
        {notice ? (
          // Said where the work would have happened, exactly like `blocked`
          // above — and unlike `blocked` the roster still follows it, because
          // seeing who is expected is the whole reason a shadow is here.
          <View className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <View className="flex-row items-center gap-2">
              <Ionicons name="eye-outline" size={16} color="#6d28d9" />
              <Text className="text-sm font-bold text-violet-900">
                {notice.title}
              </Text>
            </View>
            <Text className="text-xs text-violet-800 mt-1 leading-5">
              {notice.detail}
            </Text>
          </View>
        ) : (
          <Text className="text-sm text-gray-500 mb-1">
            Tap a status for each student
          </Text>
        )}

        {students.length === 0 ? (
          <View className="bg-white rounded-2xl p-6 items-center border border-gray-100">
            <Text className="text-gray-400 text-sm">No students enrolled</Text>
          </View>
        ) : (
          students.map((student) => {
            const state = attendance[student.id] ?? {
              top: "unmarked",
              sub: null,
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
                    // Not a weekly regular — say which kind. A TRIAL is
                    // someone the coach is meeting for the first time and the
                    // status they pick decides what the family is charged; a
                    // MAKE-UP is an enrolled child guesting from another class
                    // for this one lesson.
                    <View
                      className={`px-2 py-0.5 rounded-full ${
                        student.isTrial
                          ? "bg-sky-100"
                          : student.isMakeup
                            ? "bg-emerald-100"
                            : "bg-amber-100"
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-semibold ${
                          student.isTrial
                            ? "text-sky-700"
                            : student.isMakeup
                              ? "text-emerald-700"
                              : "text-amber-700"
                        }`}
                      >
                        {student.isTrial
                          ? "Trial"
                          : student.isMakeup
                            ? "Make-up"
                            : "Not enrolled"}
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

                {/* Public-holiday void — read-only. Set by the admin; a coach
                    cannot change it (the DB guard refuses), so no buttons show. */}
                {state.top === "holiday" && (
                  <View className="flex-row items-center gap-1.5 mb-1">
                    <View className="w-2 h-2 rounded-full bg-purple-400" />
                    <Text className="text-xs text-purple-500 font-medium">
                      Public holiday — no charge
                    </Text>
                  </View>
                )}

                {/* Top-level status buttons. A make-up guest gets the ordinary
                    statuses only: the trial statuses price by the trial rate,
                    and a make-up is not a trial. Affordance, not the guard —
                    the engine prices a mismark at the class rate. Hidden for a
                    holiday row, which is read-only. */}
                {state.top !== "holiday" && (
                <View className="flex-row gap-2">
                  {TOP_STATUSES.filter(
                    ({ key }) => !(student.isMakeup && key === "trial")
                  ).map(({ key, label, ring, bg }) => {
                    const isSelected = state.top === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        disabled={readOnly}
                        onPress={() => setTop(student.id, key)}
                        className={`flex-1 py-2 rounded-xl border-2 items-center ${
                          isSelected
                            ? `${ring} ${bg}`
                            : "border-gray-200 bg-gray-50"
                        } ${readOnly && !isSelected ? "opacity-50" : ""}`}
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
                )}

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
                        disabled={readOnly}
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
                        disabled={readOnly}
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

        {/* ── Coaches present ────────────────────────────────────────────
            Renders NOTHING when the class has no shadows, so a business that
            has never assigned one gains no new furniture on its screens.

            Pre-ticked on purpose. The failure mode of a blank list is a coach
            who forgets and silently costs a trainee their pay, which appears
            nowhere; the failure mode of a pre-ticked one is an overpayment,
            which appears as a line on the Wages page and can be seen. */}
        {!readOnly && shadowsHere.length > 0 && (
          <View className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
            <Text className="text-sm font-semibold text-gray-900">
              Coaches present
            </Text>
            <Text className="mt-0.5 text-xs text-gray-500">
              Untick anyone who wasn&apos;t here — they won&apos;t be paid for
              this lesson.
            </Text>
            {shadowsHere.map((sh) => (
              <TouchableOpacity
                key={sh.coach_id}
                onPress={() =>
                  setShadowsHere((prev) =>
                    prev.map((x) =>
                      x.coach_id === sh.coach_id
                        ? { ...x, present: !x.present }
                        : x
                    )
                  )
                }
                className="mt-3 flex-row items-center"
              >
                <View
                  className={`h-5 w-5 items-center justify-center rounded border ${
                    sh.present
                      ? "bg-blue-500 border-blue-500"
                      : "bg-white border-gray-300"
                  }`}
                >
                  {sh.present && (
                    <Text className="text-xs font-bold text-white">✓</Text>
                  )}
                </View>
                {/* ⚠ THE NAME IS ITS OWN LEAF <Text>, DIRECTLY INSIDE THE
                    TOUCHABLE. RN-web puts the press handler on the Pressable and
                    a click on a nested Text child is swallowed silently — the
                    same trap every marking driver in this repo works around. A
                    name wrapped in an outer Text with a sibling span is not a
                    leaf at all, so it cannot be pressed by text and the tick
                    becomes untestable. */}
                <Text
                  className={`ml-2.5 text-sm ${
                    sh.present ? "text-gray-900" : "text-gray-400"
                  }`}
                >
                  {sh.name}
                </Text>
                <Text className="ml-1 text-xs text-gray-400">· shadowing</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* No save button at all when the lesson is not mine to mark. A
            disabled one would still read as "this is my job, and it is
            broken"; its absence plus the notice above says whose job it is. */}
        {!readOnly && (
          <PrimaryButton
            label={saving ? "Saving…" : "Save Attendance"}
            onPress={handleSave}
            className="mt-2"
          />
        )}
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
