import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";
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
  const { date, sessionId: sessionIdParam } = useLocalSearchParams<{
    date: string;
    sessionId?: string;
  }>();

  const session = useAppStore((s) => s.session);

  const [classTitle, setClassTitle] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttState>>({});
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(
    sessionIdParam ?? null
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);

    // Load class title + enrolled students
    const { data: cls } = await supabase
      .from("classes")
      .select(`
        title,
        student_class_enrolments(
          is_active,
          students(id, full_name)
        )
      `)
      .eq("id", id)
      .single();

    if (!cls) {
      setLoading(false);
      return;
    }

    setClassTitle(cls.title);

    const activeStudents: StudentRow[] = (cls.student_class_enrolments ?? [])
      .filter((e: any) => e.is_active)
      .map((e: any) => ({
        id: e.students.id,
        full_name: e.students.full_name,
      }));

    setStudents(activeStudents);

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

    setResolvedSessionId(sid);

    // Pre-fill attendance from existing records (or default to present)
    const initAtt: Record<string, AttState> = {};
    if (sid) {
      const { data: attData } = await supabase
        .from("attendance")
        .select("id, student_id, status")
        .eq("lesson_session_id", sid);

      for (const student of activeStudents) {
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
      for (const student of activeStudents) {
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

  async function handleSave() {
    // Validate all statuses are complete
    for (const student of students) {
      const state = attendance[student.id];
      if (!state || state.top === "unmarked") {
        Alert.alert(
          "Incomplete",
          `Please mark attendance for ${student.full_name}.`
        );
        return;
      }
      if (toDBStatus(state.top, state.sub) === null) {
        Alert.alert(
          "Incomplete",
          `Please select a sub-type for ${student.full_name}.`
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
      Alert.alert("Error", "Could not find coach record.");
      setSaving(false);
      return;
    }

    // Create session row if it doesn't exist yet
    let finalSessionId = resolvedSessionId;
    if (!finalSessionId) {
      const { data: newSession, error: sessionError } = await supabase
        .from("lesson_sessions")
        .insert({ class_id: id, session_date: date, status: "scheduled" })
        .select("id")
        .single();

      if (sessionError || !newSession) {
        Alert.alert("Error", "Could not create session record.");
        setSaving(false);
        return;
      }

      finalSessionId = newSession.id;
      setResolvedSessionId(finalSessionId);
    }

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
      Alert.alert("Error", "Failed to save attendance. Please try again.");
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
    Alert.alert("Saved", "Attendance saved successfully.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  }

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
          <Text className="text-lg font-bold text-gray-900">Mark Attendance</Text>
          <Text className="text-xs text-gray-500">
            {classTitle} · {formatDate(date)}
          </Text>
        </View>
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
    </SafeAreaView>
  );
}
