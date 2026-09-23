// The profile card: name, status, Edit, and the detail rows.
// Moved VERBATIM from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import type { ChildDetail } from "../types";
import { capitalize, formatDate } from "../domain/childFormat";
import { Row } from "./Row";

export function ProfileCard(p: { child: ChildDetail; age: number | null }) {
  const { child, age } = p;
  return (
    <>
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
          {/* Editing is the parent's, per PRD §7.4 — which claimed it long
              before anything implemented it. Only the profile fields: the
              business, the class assignment and activity all belong to the
              business's admin. */}
          <TouchableOpacity
            onPress={() => router.push(`/(parent)/home/edit-child?id=${child.id}`)}
            className="px-3 py-1.5 rounded-lg border border-gray-200"
          >
            <Text className="text-sm font-medium text-sky-600">Edit</Text>
          </TouchableOpacity>
        </View>

        <View className="gap-2">
          <Row label="Date of Birth" value={formatDate(child.date_of_birth)} />
          {/* Derived, never stored — see ageFromDob. Omitted rather than
              shown as 0 when the DOB is missing or unparseable. */}
          {age !== null ? (
            <Row label="Age" value={`${age} ${age === 1 ? "year" : "years"} old`} />
          ) : null}
          <Row label="Gender"        value={capitalize(child.gender)} />
          {/* Set by the business's admin; read-only to the parent. Omitted
              rather than shown as "—" when unset — a business that does not
              use levels should not have an empty row on every child. */}
          {child.level_label ? (
            <Row label="Level" value={child.level_label} />
          ) : null}
          {child.notes ? <Row label="Notes" value={child.notes} /> : null}
        </View>
      </Card>
    </>
  );
}
