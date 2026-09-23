// "My Children": the header, the loading / empty states and one card per child.
// Moved VERBATIM from app/(parent)/home/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";
import PackageBadge from "@/components/PackageBadge";
import Card from "@/components/Card";
import { formatSgDate } from "@/lib/lessonDates";
import { capitalize } from "../domain/homeRows";
import type { useParentHome } from "../domain/useParentHome";

type Home = ReturnType<typeof useParentHome>;

export function ChildrenSection(p: Pick<Home, "loading" | "children" | "covMap">) {
  const { loading, children, covMap } = p;
  return (
    <>
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
                      <View className="mt-0.5">
                        <PackageBadge coverage={covMap.get(child.id)} />
                      </View>
                    </View>
                  </View>
                  <StatusBadge
                    status={
                      child.is_active
                        ? capitalize(child.assignment_status)
                        : "Inactive"
                    }
                    size="sm"
                  />
                </View>

                {child.is_active && child.assignment_status === "assigned" ? (
                  <>
                    {/* ONE BLOCK PER CLASS. A child in two classes gets two,
                        in weekday order. The key is day+time rather than the
                        array index: a child can legitimately hold two classes
                        on the same weekday at different times, so the day
                        alone is not unique. */}
                    {child.classes.map((c, i) => (
                      <View
                        key={`${c.day}-${c.time}-${i}`}
                        className={`bg-sky-50 rounded-xl p-3 gap-1 ${i > 0 ? "mt-2" : ""}`}
                      >
                        <View className="flex-row items-center gap-1.5">
                          <Ionicons name="person-outline" size={13} color="#0284c7" />
                          <Text className="text-xs text-sky-700">
                            {c.coach_name ?? "—"}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-1.5">
                          <Ionicons name="calendar-outline" size={13} color="#0284c7" />
                          <Text className="text-xs text-sky-700">
                            {capitalize(c.day)} · {c.time}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-1.5">
                          <Ionicons name="location-outline" size={13} color="#0284c7" />
                          <Text className="text-xs text-sky-700">
                            {c.location ?? "—"}
                          </Text>
                        </View>
                      </View>
                    ))}
                    {child.makeup && (
                      /* IN ADDITION to the class block — the weekly class
                         stands; this one lesson is extra. Says WHEN and
                         WHERE, the whole question a family has. */
                      <View className="mt-2 bg-emerald-50 rounded-xl p-3">
                        <Text className="text-xs font-semibold text-emerald-800">
                          Make-up lesson booked
                        </Text>
                        <Text className="mt-0.5 text-xs text-emerald-700">
                          {child.makeup.class_title} ·{" "}
                          {formatSgDate(child.makeup.session_date, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </Text>
                      </View>
                    )}
                  </>
                ) : !child.is_active ? (
                  // An inactive child is NOT waiting for placement — telling
                  // them "the admin will assign your child soon" promises
                  // something that is not coming.
                  <View className="bg-gray-100 rounded-xl p-3">
                    <Text className="text-xs text-gray-600">
                      No longer attending. Their attendance and invoices are
                      still here. Contact your coach if this looks wrong.
                    </Text>
                  </View>
                ) : child.trial ? (
                  /* Booked for one lesson. Says WHEN, which is the whole
                     question a family has about a trial. */
                  <View className="bg-sky-50 rounded-xl p-3">
                    <Text className="text-xs font-semibold text-sky-800">
                      Trial lesson booked
                    </Text>
                    <Text className="mt-0.5 text-xs text-sky-700">
                      {child.trial.class_title} ·{" "}
                      {formatSgDate(child.trial.session_date, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </Text>
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
    </>
  );
}
