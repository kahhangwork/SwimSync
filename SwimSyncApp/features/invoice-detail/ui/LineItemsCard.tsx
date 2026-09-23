// Lesson Breakdown — one line per lesson, tagged when a package paid it.
// Moved VERBATIM from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import Card from "@/components/Card";
import type { InvoiceDetail } from "../types";
import { formatDate, capitalize } from "../domain/invoiceDetailFormat";

export function LineItemsCard(p: { invoice: InvoiceDetail }) {
  const { invoice } = p;
  return (
    <>
      {/* Line items */}
      <Card>
        <Text className="text-base font-bold text-gray-900 mb-3">
          Lesson Breakdown
        </Text>
        <View className="gap-2">
          {invoice.items.map((item) => (
            <View
              key={item.id}
              className="flex-row justify-between py-2 border-b border-gray-50"
            >
              <View className="flex-1">
                <Text className="text-sm text-gray-700">{item.class_title}</Text>
                <Text className="text-xs text-gray-400">
                  {formatDate(item.session_date)} · {item.student_name}
                </Text>
                <Text className="text-xs text-gray-400">
                  {capitalize(item.attendance_status)}
                </Text>
                {item.funded_by && (
                  <Text className="text-xs font-semibold text-emerald-600">
                    Paid by package · {item.funded_by}
                  </Text>
                )}
              </View>
              <Text
                className={`text-sm font-medium ${
                  item.funded_by ? "text-emerald-600" : "text-gray-800"
                }`}
              >
                S${item.amount.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </>
  );
}
