// "My Children": the header, the loading / empty states and one card per child.
// Moved from app/(parent)/home/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-F).
// UI restyle step 3.4 — ONE tag per card, and only for a state that is not routine
// (BACKLOG fold-in: a green "Assigned" on every card said nothing). An active,
// assigned child has no tag; Unassigned and Inactive keep theirs. The class /
// trial / make-up blocks are flat Ground panels.
import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";
import PackageBadge from "@/components/PackageBadge";
import { Surface, SURFACE } from "@/components/ui/Surface";
import { formatSgDate } from "@/lib/lessonDates";
import { capitalize } from "../domain/homeRows";
import type { useParentHome } from "../domain/useParentHome";

type Home = ReturnType<typeof useParentHome>;

const PANEL = "bg-ground border border-border rounded-control p-3 gap-1";

export function ChildrenSection(p: Pick<Home, "loading" | "children" | "covMap">) {
  const { loading, children, covMap } = p;
  return (
    <>
      {/* Children section */}
      <View className="flex-row items-center justify-between mb-2 mt-2">
        <Text className="text-headline font-semibold text-ink">My Children</Text>
        <TouchableOpacity
          onPress={() => router.push("/(parent)/home/add-child")}
          className="min-h-11 flex-row items-center gap-1"
        >
          <Ionicons name="add" size={18} color="#2563eb" />
          <Text className="text-body font-semibold text-primary">Add Child</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : children.length === 0 ? (
        <Surface className="items-center py-10">
          <Ionicons name="people-outline" size={40} color="#6b6b6b" />
          <Text className="text-body text-ink-secondary mt-3">No children added yet</Text>
          <TouchableOpacity
            onPress={() => router.push("/(parent)/home/add-child")}
            className="mt-1 min-h-11 justify-center"
          >
            <Text className="text-body font-semibold text-primary">
              Add your first child
            </Text>
          </TouchableOpacity>
        </Surface>
      ) : (
        <View className="gap-3">
          {children.map((child) => {
            const routine = child.is_active && child.assignment_status === "assigned";
            return (
            <TouchableOpacity
              key={child.id}
              onPress={() => router.push(`/(parent)/home/child/${child.id}`)}
              activeOpacity={0.8}
              className={SURFACE}
            >
                <View className="flex-row items-start justify-between gap-3 mb-3">
                  <View className="flex-1">
                    <Text className="text-headline font-semibold text-ink">
                      {child.full_name}
                    </Text>
                    {/* Directly under the name: verify-packages and
                        verify-single-child-packages read "<name>\n<line>". */}
                    <PackageBadge coverage={covMap.get(child.id)} />
                  </View>
                  {!routine && (
                    <StatusBadge
                      status={
                        child.is_active
                          ? capitalize(child.assignment_status)
                          : "Inactive"
                      }
                      size="sm"
                    />
                  )}
                </View>

                {routine ? (
                  <>
                    {/* ONE BLOCK PER CLASS. A child in two classes gets two,
                        in weekday order. The key is day+time rather than the
                        array index: a child can legitimately hold two classes
                        on the same weekday at different times, so the day
                        alone is not unique. */}
                    {child.classes.map((c, i) => (
                      <View
                        key={`${c.day}-${c.time}-${i}`}
                        className={`${PANEL} ${i > 0 ? "mt-2" : ""}`}
                      >
                        <View className="flex-row items-center gap-1.5">
                          <Ionicons name="calendar-outline" size={14} color="#525252" />
                          <Text className="text-body text-ink">
                            {capitalize(c.day)} · {c.time}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-1.5">
                          <Ionicons name="location-outline" size={14} color="#525252" />
                          <Text className="text-body-secondary text-ink-secondary">
                            {c.location ?? "—"}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-1.5">
                          <Ionicons name="person-outline" size={14} color="#525252" />
                          <Text className="text-body-secondary text-ink-secondary">
                            {c.coach_name ?? "—"}
                          </Text>
                        </View>
                      </View>
                    ))}
                    {child.makeup && (
                      /* IN ADDITION to the class block — the weekly class
                         stands; this one lesson is extra. Says WHEN and
                         WHERE, the whole question a family has. */
                      <View className={`${PANEL} mt-2`}>
                        <Text className="text-body font-semibold text-ink">
                          Make-up lesson booked
                        </Text>
                        <Text className="text-body-secondary text-ink-secondary">
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
                  <View className={PANEL}>
                    <Text className="text-body-secondary text-ink-secondary">
                      No longer attending. Their attendance and invoices are
                      still here. Contact your coach if this looks wrong.
                    </Text>
                  </View>
                ) : child.trial ? (
                  /* Booked for one lesson. Says WHEN, which is the whole
                     question a family has about a trial. */
                  <View className={PANEL}>
                    <Text className="text-body font-semibold text-ink">
                      Trial lesson booked
                    </Text>
                    <Text className="text-body-secondary text-ink-secondary">
                      {child.trial.class_title} ·{" "}
                      {formatSgDate(child.trial.session_date, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </Text>
                  </View>
                ) : (
                  <View className={PANEL}>
                    <Text className="text-body-secondary text-ink-secondary">
                      Not yet assigned to a class. The admin will assign your child soon.
                    </Text>
                  </View>
                )}
            </TouchableOpacity>
            );
          })}
        </View>
      )}
    </>
  );
}
