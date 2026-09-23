// Credit Notes Applied, when there are any.
// Moved VERBATIM from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import Card from "@/components/Card";
import type { InvoiceDetail } from "../types";

export function CreditNotesCard(p: { invoice: InvoiceDetail }) {
  const { invoice } = p;
  return (
    <>
      {/* Credit notes applied */}
      {invoice.credit_notes.length > 0 && (
        <Card>
          <Text className="text-base font-bold text-gray-900 mb-3">
            Credit Notes Applied
          </Text>
          {invoice.credit_notes.map((cn) => (
            <View
              key={cn.id}
              className="flex-row justify-between py-2 border-b border-gray-50"
            >
              <View className="flex-1">
                <Text className="text-sm text-gray-700">{cn.reference_number}</Text>
                {cn.reason ? (
                  <Text className="text-xs text-gray-400">{cn.reason}</Text>
                ) : null}
              </View>
              <Text className="text-sm font-medium text-blue-600">
                −S${cn.amount.toFixed(2)}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}
