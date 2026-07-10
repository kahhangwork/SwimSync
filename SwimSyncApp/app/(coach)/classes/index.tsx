import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import Card from "@/components/Card";

type CoachClass = {
  id: string;
  title: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  location_name: string;
  price_per_lesson: number;
  student_count: number;
};

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function ClassesScreen() {
  const session = useAppStore((s) => s.session);
  const [classes, setClasses] = useState<CoachClass[]>([]);
  const [loading, setLoading] = useState(true);

  const loadClasses = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    const { data: coach } = await supabase
      .from("coaches")
      .select("id")
      .eq("profile_id", session.id)
      .single();

    if (!coach) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("classes")
      .select(`
        id,
        title,
        day_of_week,
        start_time,
        end_time,
        location_name,
        price_per_lesson,
        student_class_enrolments(id, is_active)
      `)
      .eq("coach_id", coach.id)
      .eq("is_active", true)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });

    setClasses(
      (data ?? []).map((cls: any) => ({
        id: cls.id,
        title: cls.title,
        day_of_week: cls.day_of_week,
        start_time: cls.start_time,
        end_time: cls.end_time,
        location_name: cls.location_name,
        price_per_lesson: Number(cls.price_per_lesson),
        student_count: (cls.student_class_enrolments ?? []).filter(
          (e: any) => e.is_active
        ).length,
      }))
    );

    setLoading(false);
  }, [session]);

  useFocusEffect(loadClasses);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-6">
          <Text className="text-2xl font-bold text-gray-900">My Classes</Text>
          <Text className="text-sm text-gray-500 mt-0.5">
            All assigned classes
          </Text>
        </View>

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : classes.length === 0 ? (
          <Card className="items-center py-10">
            <Ionicons name="calendar-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 text-sm">No classes assigned yet</Text>
          </Card>
        ) : (
          <View className="gap-3">
            {classes.map((cls) => (
              <TouchableOpacity
                key={cls.id}
                onPress={() => router.push(`/(coach)/classes/${cls.id}/roster`)}
                activeOpacity={0.8}
              >
                <Card>
                  <View className="flex-row items-start justify-between mb-3">
                    <View className="flex-1">
                      <Text className="text-base font-bold text-gray-900">
                        {cls.title}
                      </Text>
                      <Text className="text-xs text-gray-500 mt-0.5">
                        {capitalize(cls.day_of_week)}
                      </Text>
                    </View>
                    <View className="bg-sky-100 rounded-full px-3 py-1">
                      <Text className="text-xs font-semibold text-sky-700">
                        {cls.student_count} students
                      </Text>
                    </View>
                  </View>

                  <View className="gap-1.5">
                    <View className="flex-row items-center gap-2">
                      <Ionicons name="time-outline" size={14} color="#6b7280" />
                      <Text className="text-sm text-gray-600">
                        {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <Ionicons name="location-outline" size={14} color="#6b7280" />
                      <Text className="text-sm text-gray-600">
                        {cls.location_name}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <Ionicons name="cash-outline" size={14} color="#6b7280" />
                      <Text className="text-sm text-gray-600">
                        S${cls.price_per_lesson.toFixed(2)} / lesson
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center justify-end mt-3 gap-1">
                    <Text className="text-xs text-sky-500">View Roster & Sessions</Text>
                    <Ionicons name="chevron-forward" size={13} color="#0ea5e9" />
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
