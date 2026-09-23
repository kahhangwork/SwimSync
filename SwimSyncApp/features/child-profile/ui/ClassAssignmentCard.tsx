// Class Assignment — one group of rows per class.
// Moved VERBATIM from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import Card from "@/components/Card";
import type { ChildDetail } from "../types";
import { capitalize } from "../domain/childFormat";
import { Row } from "./Row";

export function ClassAssignmentCard(p: { child: ChildDetail }) {
  const { child } = p;
  return (
    <>
      {/* Assignment / Class info */}
      <Card>
        <Text className="text-base font-bold text-gray-900 mb-3">
          Class Assignment
        </Text>
        {child.is_active && child.assignment_status === "assigned" ? (
          /* One group of rows per class, separated by a rule so two classes
             cannot read as one muddled set of details. A child with a single
             class renders exactly as before — no divider, no heading. */
          <View className="gap-2">
            {child.classes.map((c, i) => (
              <View
                key={`${c.day}-${c.time}-${i}`}
                className={
                  i > 0 ? "gap-2 pt-3 mt-1 border-t border-gray-200" : "gap-2"
                }
              >
                <Row label="Coach"    value={c.coach_name ?? "—"} />
                <Row label="Day"      value={capitalize(c.day)} />
                <Row label="Time"     value={c.time ?? "—"} />
                <Row label="Location" value={c.location ?? "—"} />
                {c.location_address ? (
                  <Row label="Address" value={c.location_address} />
                ) : null}
                {c.location_notes ? (
                  <Row label="Getting there" value={c.location_notes} />
                ) : null}
              </View>
            ))}
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
    </>
  );
}
