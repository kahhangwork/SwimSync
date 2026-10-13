// Class Assignment — one group of rows per class.
// Moved from app/(parent)/home/child/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); DESIGN.md in UI restyle step 3.5 — flat Ground panels, no yellow.
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import type { ChildDetail } from "../types";
import { capitalize } from "../domain/childFormat";
import { Row } from "./Row";

export function ClassAssignmentCard(p: { child: ChildDetail }) {
  const { child } = p;
  return (
    <Surface>
      <Text className="text-headline font-semibold text-ink mb-1">
        Class Assignment
      </Text>
      {child.is_active && child.assignment_status === "assigned" ? (
        /* One group of rows per class, separated by a rule so two classes
           cannot read as one muddled set of details. A child with a single
           class renders exactly as before — no divider, no heading. */
        <View>
          {child.classes.map((c, i) => (
            <View
              key={`${c.day}-${c.time}-${i}`}
              className={i > 0 ? "pt-2 mt-2 border-t border-border" : ""}
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
        <View className="mt-2 bg-ground border border-border rounded-control p-3">
          <Text className="text-body text-ink-secondary">
            No longer attending. Their attendance history and invoices are
            still here. Contact your coach if this looks wrong.
          </Text>
        </View>
      ) : (
        <View className="mt-2 bg-ground border border-border rounded-control p-3">
          <Text className="text-body text-ink-secondary">
            Your child has not been assigned to a class yet. The admin will
            assign them shortly.
          </Text>
        </View>
      )}
    </Surface>
  );
}
