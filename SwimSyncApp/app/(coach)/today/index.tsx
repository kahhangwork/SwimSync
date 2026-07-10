import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
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

const DAY_MAP: Record<number, string> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
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
  const [outstandingCount, setOutstandingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const todayStr = today.toLocaleDateString("en-SG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayDayOfWeek = DAY_MAP[today.getDay()];
  const todayDate = today.toISOString().split("T")[0]; // YYYY-MM-DD

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

    // Get today's classes for this coach
    const { data: todayClasses } = await supabase
      .from("classes")
      .select(`
        id,
        title,
        start_time,
        end_time,
        location_name,
        student_class_enrolments(id, is_active)
      `)
      .eq("coach_id", coach.id)
      .eq("is_active", true)
      .eq("day_of_week", todayDayOfWeek)
      .order("start_time", { ascending: true });

    // For each class, check if a lesson session exists for today
    const classIds = (todayClasses ?? []).map((c: any) => c.id);
    const { data: sessions } = classIds.length > 0
      ? await supabase
          .from("lesson_sessions")
          .select("id, class_id")
          .in("class_id", classIds)
          .eq("session_date", todayDate)
      : { data: [] };

    const sessionMap: Record<string, string> = {};
    (sessions ?? []).forEach((s: any) => {
      sessionMap[s.class_id] = s.id;
    });

    const mapped: TodayClass[] = (todayClasses ?? []).map((cls: any) => ({
      id: cls.id,
      title: cls.title,
      start_time: cls.start_time,
      end_time: cls.end_time,
      location_name: cls.location_name,
      student_count: (cls.student_class_enrolments ?? []).filter(
        (e: any) => e.is_active
      ).length,
      session_id: sessionMap[cls.id] ?? null,
    }));

    setClasses(mapped);

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

  useFocusEffect(loadData);

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
