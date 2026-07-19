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
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";

type ChildDetail = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  swimming_ability: string | null;
  notes: string | null;
  // "inactive" was dropped from the enum — activity is its own axis now
  // (students.is_active), so a departed child must not read "Unassigned".
  assignment_status: "unassigned" | "assigned";
  is_active: boolean;
  coach_name: string | null;
  class_day: string | null;
  class_time: string | null;
  class_location: string | null;
  outstanding_amount: number;
  credit_balance: number;
};

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function capitalize(str: string | null): string {
  if (!str) return "—";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-SG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ChildProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [child, setChild] = useState<ChildDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadChild = useCallback(async () => {
    setLoading(true);

    const { data: student } = await supabase
      .from("students")
      .select(`
        id,
        full_name,
        date_of_birth,
        gender,
        swimming_ability,
        notes,
        assignment_status,
        is_active,
        student_class_enrolments(
          is_active,
          classes(
            day_of_week,
            start_time,
            end_time,
            location_name,
            coaches(
              profiles(full_name)
            )
          )
        )
      `)
      .eq("id", id)
      .single();

    if (!student) {
      setLoading(false);
      return;
    }

    const activeEnrolment = (student.student_class_enrolments ?? []).find(
      (e: any) => e.is_active
    );
    const cls: any = activeEnrolment?.classes ?? null;
    const coachProfile = cls?.coaches?.profiles ?? null;

    // Fetch outstanding invoices for the parent linked to this student
    const { data: parentStudentLink } = await supabase
      .from("parent_students")
      .select("parent_id")
      .eq("student_id", id)
      .single();

    let outstandingAmount = 0;
    let creditBalance = 0;

    if (parentStudentLink) {
      const { data: invoices } = await supabase
        .from("invoices")
        .select("net_amount")
        .eq("parent_id", parentStudentLink.parent_id)
        .eq("status", "outstanding");

      outstandingAmount = (invoices ?? []).reduce(
        (sum: number, inv: any) => sum + Number(inv.net_amount),
        0
      );

      const { data: parentRecord } = await supabase
        .from("parents")
        .select("parent_tenant_balances(credit_balance)")
        .eq("id", parentStudentLink.parent_id)
        .single();

      // Summed across businesses — see the note in home/index.tsx.
      creditBalance = ((parentRecord as any)?.parent_tenant_balances ?? []).reduce(
        (sum: number, b: any) => sum + Number(b.credit_balance ?? 0),
        0
      );
    }

    setChild({
      id: student.id,
      full_name: student.full_name,
      date_of_birth: student.date_of_birth,
      gender: student.gender,
      swimming_ability: student.swimming_ability,
      notes: student.notes,
      assignment_status: student.assignment_status,
      is_active: student.is_active,
      coach_name: coachProfile?.full_name ?? null,
      class_day: cls?.day_of_week ?? null,
      class_time: cls
        ? `${formatTime(cls.start_time)} – ${formatTime(cls.end_time)}`
        : null,
      class_location: cls?.location_name ?? null,
      outstanding_amount: outstandingAmount,
      credit_balance: creditBalance,
    });

    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadChild();
    }, [loadChild])
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  if (!child) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center px-6">
        <Ionicons name="alert-circle-outline" size={40} color="#d1d5db" />
        <Text className="text-gray-400 mt-3 text-center">
          Could not load child profile.
        </Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="text-sky-500 font-semibold">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 bg-sky-50">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900 flex-1">Child Profile</Text>
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-4"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <Card>
          <View className="flex-row items-center gap-4 mb-4">
            <View className="w-16 h-16 rounded-full bg-sky-100 items-center justify-center">
              <Text className="text-sky-600 font-bold text-2xl">
                {child.full_name.charAt(0)}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xl font-bold text-gray-900">
                {child.full_name}
              </Text>
              <StatusBadge
                status={child.is_active ? capitalize(child.assignment_status) : "Inactive"}
                size="sm"
              />
            </View>
          </View>

          <View className="gap-2">
            <Row label="Date of Birth" value={formatDate(child.date_of_birth)} />
            <Row label="Gender"        value={capitalize(child.gender)} />
            {child.notes ? <Row label="Notes" value={child.notes} /> : null}
          </View>
        </Card>

        {/* Assignment / Class info */}
        <Card>
          <Text className="text-base font-bold text-gray-900 mb-3">
            Class Assignment
          </Text>
          {child.is_active && child.assignment_status === "assigned" ? (
            <View className="gap-2">
              <Row label="Coach"    value={child.coach_name ?? "—"} />
              <Row label="Day"      value={capitalize(child.class_day)} />
              <Row label="Time"     value={child.class_time ?? "—"} />
              <Row label="Location" value={child.class_location ?? "—"} />
            </View>
          ) : !child.is_active ? (
            <View className="bg-gray-100 rounded-xl p-4">
              <Text className="text-gray-600 text-sm">
                No longer attending. Their attendance history and invoices are
                still here. Contact your coach if this looks wrong.
              </Text>
            </View>
          ) : (
            <View className="bg-yellow-50 rounded-xl p-4">
              <Text className="text-yellow-700 text-sm">
                Your child has not been assigned to a class yet. The admin will
                assign them shortly.
              </Text>
            </View>
          )}
        </Card>

        {/* Balances */}
        <Card>
          <Text className="text-base font-bold text-gray-900 mb-3">Balances</Text>
          <View className="flex-row gap-3">
            <View className="flex-1 bg-red-50 rounded-xl p-3 items-center">
              <Text className="text-xs text-red-500 mb-1">Outstanding</Text>
              <Text className="text-xl font-bold text-red-600">
                S${child.outstanding_amount.toFixed(2)}
              </Text>
            </View>
            <View className="flex-1 bg-blue-50 rounded-xl p-3 items-center">
              <Text className="text-xs text-blue-500 mb-1">Credit Balance</Text>
              <Text className="text-xl font-bold text-blue-600">
                S${child.credit_balance.toFixed(2)}
              </Text>
            </View>
          </View>
        </Card>

        {/* Quick actions */}
        <View className="gap-3">
          <PrimaryButton
            label="View Attendance History"
            onPress={() => router.push("/(parent)/attendance")}
          />
          <PrimaryButton
            label="View Invoices"
            variant="outline"
            onPress={() => router.push("/(parent)/billing")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1.5 border-b border-gray-50">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm font-medium text-gray-800 max-w-[60%] text-right">
        {value}
      </Text>
    </View>
  );
}
