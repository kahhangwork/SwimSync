// The Credit Notes tab: the empty state, or one card per note.
// Moved from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-G).
// UI restyle step 3.9: flat cards; the credit in Ink as a reduction — a true minus,
// never link-blue (BACKLOG fold-in). The amount is the note's own.
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import { formatDate, capitalize } from "../domain/billingFormat";
import type { useBilling } from "../domain/useBilling";
import { formatSgd } from "@/lib/money";

type Billing = ReturnType<typeof useBilling>;

export function CreditNotesTab(p: Pick<Billing, "creditNotes">) {
  const { creditNotes } = p;
  return (
    <>
      {
        creditNotes.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="document-outline" size={40} color="#6b6b6b" />
            <Text className="text-body text-ink-secondary mt-3">No credit notes</Text>
          </View>
        ) : (
          creditNotes.map((cn) => (
            <Surface key={cn.id}>
              <View className="flex-row items-start justify-between gap-3 mb-2">
                <View className="flex-1">
                  <Text className="text-headline font-semibold text-ink">
                    {cn.reference_number}
                  </Text>
                  <Text className="text-body-secondary text-ink-secondary mt-0.5">
                    {formatDate(cn.issued_at)}
                  </Text>
                </View>
                <StatusBadge
                  status={cn.applied_to_invoice_id ? "Applied" : "Available"}
                  size="sm"
                />
              </View>
              <Text className="text-body-secondary text-ink-secondary mb-1">
                {capitalize(cn.original_status)} → {capitalize(cn.corrected_status)}
              </Text>
              {cn.reason ? (
                <Text className="text-body text-ink mb-2">{cn.reason}</Text>
              ) : null}
              <View className="flex-row justify-between pt-2 border-t border-divider">
                <Text className="text-body text-ink-secondary">Credit Amount</Text>
                <Text className="text-body font-semibold text-ink" style={{ fontVariant: ["tabular-nums"] }}>
                  −{formatSgd(cn.amount)}
                </Text>
              </View>
            </Surface>
          ))
        )
      }
    </>
  );
}
