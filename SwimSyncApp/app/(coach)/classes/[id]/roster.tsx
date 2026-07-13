import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";

type Student = {
  id: string;
  full_name: string;
  swimming_ability: string | null;
};

type Session = {
  id: string;
  session_date: string;
  status: string;
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
  return new Date(dateStr).toLocaleDateString("en-SG", {
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
  const [loading, setLoading] = useState(true);

  const todayDate = new Date().toISOString().split("T")[0];

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
          students(id, full_name, swimming_ability)
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
      .map((e: any) => ({
        id: e.students.id,
        full_name: e.students.full_name,
        swimming_ability: e.students.swimming_ability,
      }));

    setStudents(activeStudents);

    // Load all past sessions for this class (up to today)
    const { data: sessionData } = await supabase
      .from("lesson_sessions")
      .select(`
        id,
        session_date,
        status,
        attendance(id, student_id)
      `)
      .eq("class_id", id)
      .lte("session_date", todayDate)
      .order("session_date", { ascending: false });

    const totalStudents = activeStudents.length;

    const mappedSessions: Session[] = (sessionData ?? []).map((s: any) => ({
      id: s.id,
      session_date: s.session_date,
      status: s.status,
      marked_count: (s.attendance ?? []).length,
      total_count: totalStudents,
    }));

    setSessions(mappedSessions);
    setLoading(false);
  }, [id, todayDate]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const isComplete = (s: Session) => s.marked_count >= s.total_count && s.total_count > 0;

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
        {/* Mark attendance for today */}
        <View className="mb-5">
          <PrimaryButton
            label={`Mark Attendance — Today (${formatDate(todayDate)})`}
            onPress={() =>
              router.push(`/(coach)/classes/${id}/attendance?date=${todayDate}`)
            }
          />
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
              <Card key={student.id} className="flex-row items-center gap-3">
                <View className="w-9 h-9 rounded-full bg-sky-100 items-center justify-center">
                  <Text className="text-sky-600 font-bold text-sm">
                    {student.full_name.charAt(0)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-gray-800">
                    {student.full_name}
                  </Text>
                </View>
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
              return (
                <TouchableOpacity
                  key={session.id}
                  onPress={() =>
                    router.push(
                      `/(coach)/classes/${id}/attendance?date=${session.session_date}&sessionId=${session.id}`
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Card className="flex-row items-center gap-3">
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
