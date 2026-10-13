// The profile card: name, status, Edit, and the detail rows.
// Moved from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). UI restyle step 3.5: no initial circle; the status is a tag only when
// it is not routine (as on Home — an active, assigned child needs no tag).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import StatusBadge from "@/components/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import type { ChildDetail } from "../types";
import { capitalize, formatDate } from "../domain/childFormat";
import { Row } from "./Row";

export function ProfileCard(p: { child: ChildDetail; age: number | null }) {
  const { child, age } = p;
  const routine = child.is_active && child.assignment_status === "assigned";
  return (
    <Surface>
      <View className="flex-row items-start gap-3 mb-3">
        <View className="flex-1 gap-1">
          <Text className="text-display font-semibold text-ink">
            {child.full_name}
          </Text>
          {!routine && (
            <StatusBadge
              status={child.is_active ? capitalize(child.assignment_status) : "Inactive"}
              size="sm"
            />
          )}
        </View>
        {/* Editing is the parent's, per PRD §7.4 — which claimed it long
            before anything implemented it. Only the profile fields: the
            business, the class assignment and activity all belong to the
            business's admin. */}
        <TouchableOpacity
          onPress={() => router.push(`/(parent)/home/edit-child?id=${child.id}`)}
          className="min-h-11 px-4 rounded-control items-center justify-center bg-surface border border-border-strong"
        >
          <Text className="text-body font-semibold text-ink">Edit</Text>
        </TouchableOpacity>
      </View>

      <View>
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
    </Surface>
  );
}
