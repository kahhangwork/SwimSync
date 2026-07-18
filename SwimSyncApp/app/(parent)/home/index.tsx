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
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";

type Child = {
  id: string;
  full_name: string;
  swimming_ability: string | null;
  assignment_status: "unassigned" | "assigned" | "inactive";
  coach_name: string | null;
  class_day: string | null;
  class_time: string | null;
  class_location: string | null;
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

export default function ParentHomeScreen() {
  const session = useAppStore((s) => s.session);
  const [children, setChildren] = useState<Child[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    // Fetch parent record with children and their enrolments
    const { data: parent } = await supabase
      .from("parents")
      .select(`
        id,
        parent_tenant_balances(credit_balance),
        parent_students(
          students(
            id,
            full_name,
            swimming_ability,
            assignment_status,
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
          )
        )
      `)
      .eq("profile_id", session.id)
      .single();

    if (parent) {
      // Credit is held PER BUSINESS and is only spendable there, so there is
      // no single balance any more. The summary card shows the total the family
      // holds; the Billing tab is where each business's invoice shows what its
      // own credit actually covered.
      const balances = (parent as any).parent_tenant_balances ?? [];
      setCreditBalance(
        balances.reduce((sum: number, b: any) => sum + Number(b.credit_balance ?? 0), 0)
      );

      const mapped: Child[] = (parent.parent_students ?? []).map((ps: any) => {
        const s = ps.students;
        const activeEnrolment = (s.student_class_enrolments ?? []).find(
          (e: any) => e.is_active
        );
        const cls = activeEnrolment?.classes ?? null;
        const coachProfile = cls?.coaches?.profiles ?? null;

        return {
          id: s.id,
          full_name: s.full_name,
          swimming_ability: s.swimming_ability,
          assignment_status: s.assignment_status,
          coach_name: coachProfile?.full_name ?? null,
          class_day: cls?.day_of_week ?? null,
          class_time: cls
            ? `${formatTime(cls.start_time)} – ${formatTime(cls.end_time)}`
            : null,
          class_location: cls?.location_name ?? null,
        };
      });

      setChildren(mapped);

      // Fetch total outstanding invoices for this parent
      const { data: invoices } = await supabase
        .from("invoices")
        .select("net_amount")
        .eq("parent_id", parent.id)
        .eq("status", "outstanding");

      const outstanding = (invoices ?? []).reduce(
        (sum: number, inv: any) => sum + Number(inv.net_amount),
        0
      );
      setTotalOutstanding(outstanding);
    }

    setLoading(false);
  }, [session]);

  // Reload every time the screen comes into focus (e.g. after adding a child)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting */}
        <View className="flex-row items-center justify-between mb-6">
          <View>
            <Text className="text-gray-500 text-sm">Welcome back,</Text>
            <Text className="text-2xl font-bold text-gray-900">
              {session?.fullName ?? "—"}
            </Text>
          </View>
          <View className="w-10 h-10 rounded-full bg-sky-500 items-center justify-center">
            <Text className="text-white font-bold text-base">
              {session?.fullName?.charAt(0) ?? "?"}
            </Text>
          </View>
        </View>

        {/* Outstanding summary */}
        {totalOutstanding > 0 && (
          <Card className="mb-5 bg-red-50 border-red-100">
            <View className="flex-row items-center gap-2 mb-1">
              <Ionicons name="alert-circle" size={18} color="#dc2626" />
              <Text className="text-red-600 font-semibold text-sm">
                Outstanding Payment
              </Text>
            </View>
            <Text className="text-2xl font-bold text-red-700">
              S${totalOutstanding.toFixed(2)}
            </Text>
            <Text className="text-xs text-red-500 mt-0.5">
              Across all children — tap an invoice to pay
            </Text>
          </Card>
        )}

        {/* Credit balance */}
        {creditBalance > 0 && (
          <Card className="mb-5 bg-blue-50 border-blue-100">
            <View className="flex-row items-center gap-2 mb-1">
              <Ionicons name="wallet-outline" size={18} color="#2563eb" />
              <Text className="text-blue-600 font-semibold text-sm">
                Credit Balance
              </Text>
            </View>
            <Text className="text-2xl font-bold text-blue-700">
              S${creditBalance.toFixed(2)}
            </Text>
            <Text className="text-xs text-blue-500 mt-0.5">
              Will be applied to your next invoice automatically
            </Text>
          </Card>
        )}

        {/* Children section */}
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-lg font-bold text-gray-900">My Children</Text>
          <TouchableOpacity
            onPress={() => router.push("/(parent)/home/add-child")}
            className="flex-row items-center gap-1"
          >
            <Ionicons name="add-circle-outline" size={20} color="#0ea5e9" />
            <Text className="text-sky-500 font-semibold text-sm">Add Child</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : children.length === 0 ? (
          <Card className="items-center py-10">
            <Ionicons name="people-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 text-sm">No children added yet</Text>
            <TouchableOpacity
              onPress={() => router.push("/(parent)/home/add-child")}
              className="mt-3"
            >
              <Text className="text-sky-500 font-semibold text-sm">
                Add your first child
              </Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <View className="gap-3">
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                onPress={() => router.push(`/(parent)/home/child/${child.id}`)}
                activeOpacity={0.8}
              >
                <Card>
                  <View className="flex-row items-start justify-between mb-3">
                    <View className="flex-row items-center gap-3">
                      <View className="w-10 h-10 rounded-full bg-sky-100 items-center justify-center">
                        <Text className="text-sky-600 font-bold text-base">
                          {child.full_name.charAt(0)}
                        </Text>
                      </View>
                      <View>
                        <Text className="text-base font-bold text-gray-900">
                          {child.full_name}
                        </Text>
                      </View>
                    </View>
                    <StatusBadge
                      status={capitalize(child.assignment_status)}
                      size="sm"
                    />
                  </View>

                  {child.assignment_status === "assigned" ? (
                    <View className="bg-sky-50 rounded-xl p-3 gap-1">
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="person-outline" size={13} color="#0284c7" />
                        <Text className="text-xs text-sky-700">
                          {child.coach_name ?? "—"}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="calendar-outline" size={13} color="#0284c7" />
                        <Text className="text-xs text-sky-700">
                          {capitalize(child.class_day)} · {child.class_time}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="location-outline" size={13} color="#0284c7" />
                        <Text className="text-xs text-sky-700">
                          {child.class_location ?? "—"}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View className="bg-yellow-50 rounded-xl p-3">
                      <Text className="text-xs text-yellow-700">
                        Not yet assigned to a class. The admin will assign your child soon.
                      </Text>
                    </View>
                  )}
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
