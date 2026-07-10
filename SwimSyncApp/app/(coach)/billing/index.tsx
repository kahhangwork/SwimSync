import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PLACEHOLDER_COACH_INVOICES } from "@/constants/placeholder";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";

type Filter = "All" | "Outstanding" | "Paid";

export default function CoachBillingScreen() {
  const [filter, setFilter] = useState<Filter>("All");

  const filtered =
    filter === "All"
      ? PLACEHOLDER_COACH_INVOICES
      : PLACEHOLDER_COACH_INVOICES.filter((i) => i.status === filter);

  const outstandingCount = PLACEHOLDER_COACH_INVOICES.filter(
    (i) => i.status === "Outstanding"
  ).length;
  const paidCount = PLACEHOLDER_COACH_INVOICES.filter(
    (i) => i.status === "Paid"
  ).length;

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="mb-5">
          <Text className="text-2xl font-bold text-gray-900">Billing</Text>
          <Text className="text-sm text-gray-500 mt-0.5">
            Invoices for your students
          </Text>
        </View>

        {/* Summary */}
        <View className="flex-row gap-3 mb-5">
          <View className="flex-1 bg-red-50 rounded-2xl p-3 border border-red-100 items-center">
            <Text className="text-2xl font-bold text-red-600">
              {outstandingCount}
            </Text>
            <Text className="text-xs text-red-400 mt-0.5">Outstanding</Text>
          </View>
          <View className="flex-1 bg-green-50 rounded-2xl p-3 border border-green-100 items-center">
            <Text className="text-2xl font-bold text-green-600">{paidCount}</Text>
            <Text className="text-xs text-green-400 mt-0.5">Paid</Text>
          </View>
        </View>

        {/* Filter tabs */}
        <View className="flex-row bg-gray-100 rounded-xl p-1 mb-4">
          {(["All", "Outstanding", "Paid"] as Filter[]).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className={`flex-1 py-2 rounded-lg items-center ${
                filter === f ? "bg-white shadow-sm" : ""
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  filter === f ? "text-gray-900" : "text-gray-500"
                }`}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Invoice list */}
        <View className="gap-3">
          {filtered.map((inv) => (
            <Card key={inv.id}>
              <View className="flex-row items-start justify-between mb-2">
                <View>
                  <Text className="text-sm font-bold text-gray-900">
                    {inv.student}
                  </Text>
                  <Text className="text-xs text-gray-500">
                    Parent: {inv.parent}
                  </Text>
                  <Text className="text-xs text-gray-400 mt-0.5">{inv.month}</Text>
                </View>
                <StatusBadge status={inv.status} size="sm" />
              </View>

              <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <Text className="text-base font-bold text-gray-900">
                  S${inv.net}
                </Text>
                {inv.status === "Outstanding" && (
                  <TouchableOpacity className="flex-row items-center gap-1.5 bg-green-500 px-3 py-1.5 rounded-full">
                    <Ionicons name="checkmark" size={14} color="white" />
                    <Text className="text-white text-xs font-semibold">
                      Mark Paid
                    </Text>
                  </TouchableOpacity>
                )}
                {inv.status === "Paid" && (
                  <View className="flex-row items-center gap-1">
                    <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                    <Text className="text-xs text-green-600 font-medium">
                      Paid
                    </Text>
                  </View>
                )}
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
