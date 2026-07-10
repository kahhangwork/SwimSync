import React, { useState, useCallback } from "react";
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
import Card from "@/components/Card";

type DbStatus =
  | "present"
  | "absent"
  | "cancelled_rain"
  | "cancelled_coach"
  | "trial_paid"
  | "trial_free";

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
};

const FILTER_OPTIONS: FilterOption[] = ["All", "Present", "Absent", "Cancelled", "Trial"];

const STATUS_LABEL: Record<DbStatus, string> = {
  present:          "Present",
  absent:           "Absent",
  cancelled_rain:   "Cancelled (Rain)",
  cancelled_coach:  "Cancelled (Coach)",
  trial_paid:       "Trial — Paid",
  trial_free:       "Trial — Free",
};

const STATUS_ICON: Record<DbStatus, { name: string; color: string }> = {
  present:         { name: "checkmark-circle", color: "#16a34a" },
  absent:          { name: "close-circle",     color: "#9ca3af" },
  cancelled_rain:  { name: "rainy",            color: "#ea580c" },
  cancelled_coach: { name: "ban",              color: "#ea580c" },
  trial_paid:      { name: "star",             color: "#2563eb" },
  trial_free:      { name: "star-outline",     color: "#2563eb" },
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

export default function AttendanceScreen() {
  const session = useAppStore((s) => s.session);
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filter, setFilter] = useState<FilterOption>("All");
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);

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
      .select("students(id, full_name)")
      .eq("parent_id", parent.id);

    const childList: Child[] = (links ?? []).map((l: any) => ({
      id: l.students.id,
      full_name: l.students.full_name,
    }));

    setChildren(childList);
    if (childList.length > 0 && !selectedChildId) {
      setSelectedChildId(childList[0].id);
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

    setRecords(mapped);
    setLoadingRecords(false);
  }, [selectedChildId]);

  useFocusEffect(
    useCallback(() => {
      loadAttendance();
    }, [loadAttendance])
  );

  const filtered = records.filter((r) => matchesFilter(r.status, filter));

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="px-5 pt-5 pb-3">
        <Text className="text-2xl font-bold text-gray-900">Attendance</Text>
        <Text className="text-sm text-gray-500 mt-0.5">
          Lesson history for your children
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
          contentContainerClassName="px-5 gap-2 mb-3"
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
        contentContainerClassName="px-5 gap-2 mb-4"
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
        {loadingRecords ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : children.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="people-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3">No children added yet</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="calendar-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3">No records found</Text>
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
