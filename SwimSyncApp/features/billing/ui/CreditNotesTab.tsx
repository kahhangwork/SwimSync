// The Credit Notes tab: the empty state, or one card per note.
// Moved VERBATIM from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import { formatDate, capitalize } from "../domain/billingFormat";
import type { useBilling } from "../domain/useBilling";

type Billing = ReturnType<typeof useBilling>;

export function CreditNotesTab(p: Pick<Billing, "creditNotes">) {
  const { creditNotes } = p;
  return (
    <>
      {
        creditNotes.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="document-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3">No credit notes</Text>
          </View>
        ) : (
          creditNotes.map((cn) => (
            <Card key={cn.id}>
              <View className="flex-row items-start justify-between mb-2">
                <View>
                  <Text className="text-base font-bold text-gray-900">
                    {cn.reference_number}
                  </Text>
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {formatDate(cn.issued_at)}
                  </Text>
                </View>
                <StatusBadge
                  status={cn.applied_to_invoice_id ? "Applied" : "Available"}
                  size="sm"
                />
              </View>
              <Text className="text-xs text-gray-500 mb-1">
                {capitalize(cn.original_status)} → {capitalize(cn.corrected_status)}
              </Text>
              {cn.reason ? (
                <Text className="text-sm text-gray-600 mb-2">{cn.reason}</Text>
              ) : null}
              <View className="flex-row justify-between pt-2 border-t border-gray-100">
                <Text className="text-sm text-gray-500">Credit Amount</Text>
                <Text className="text-sm font-bold text-blue-600">
                  S${Number(cn.amount).toFixed(2)}
                </Text>
              </View>
            </Card>
          ))
        )
      }
    </>
  );
}
