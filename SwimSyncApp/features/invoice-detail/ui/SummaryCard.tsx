// The summary card: month, business, reference, dates and the money lines.
// Moved VERBATIM from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import Card from "@/components/Card";
import { invoiceLabel } from "@/lib/invoiceLabel";
import type { InvoiceDetail } from "../types";
import { formatBillingMonth, formatDate } from "../domain/invoiceDetailFormat";

export function SummaryCard(p: { invoice: InvoiceDetail }) {
  const { invoice } = p;
  return (
    <>
      {/* Summary card */}
      <Card>
        <Text className="text-base font-bold text-gray-900 mb-1">
          {formatBillingMonth(invoice.billing_month)}
        </Text>
        <Text className="text-xs font-medium text-sky-600 mb-1">
          From {invoice.business_name}
        </Text>
        {/* The reference the parent will actually quote — it is what the QR
            locks in, what the WhatsApp reminder says, and what lands on their
            bank statement. Selectable so it can be copied into a transfer
            made outside the QR. */}
        <Text selectable className="text-xs font-semibold text-gray-700 mb-1">
          {invoiceLabel(invoice)}
        </Text>
        <Text className="text-xs text-gray-500 mb-1">
          Generated {formatDate(invoice.generated_at)}
        </Text>
        {invoice.paid_at && (
          <Text className="text-xs text-green-600 mb-3">
            Paid {formatDate(invoice.paid_at)}
          </Text>
        )}

        <View className="gap-2 mt-2">
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray-500">Gross Amount</Text>
            <Text className="text-sm text-gray-700">
              S${invoice.gross_amount.toFixed(2)}
            </Text>
          </View>
          {invoice.package_applied > 0 && (
            <View className="flex-row justify-between">
              <Text className="text-sm text-blue-500">Package Applied</Text>
              <Text className="text-sm text-blue-500">
                −S${invoice.package_applied.toFixed(2)}
              </Text>
            </View>
          )}
          {invoice.credit_applied > 0 && (
            <View className="flex-row justify-between">
              <Text className="text-sm text-blue-500">Credit Applied</Text>
              <Text className="text-sm text-blue-500">
                −S${invoice.credit_applied.toFixed(2)}
              </Text>
            </View>
          )}
          {invoice.balance_adjustment > 0 && (
            <View className="flex-row justify-between">
              <Text className="text-sm text-red-500">Adjustment from a prior invoice</Text>
              <Text className="text-sm text-red-500">
                +S${invoice.balance_adjustment.toFixed(2)}
              </Text>
            </View>
          )}
          <View className="flex-row justify-between pt-2 border-t border-gray-100">
            <Text className="text-base font-bold text-gray-900">Net Payable</Text>
            <Text
              className={`text-base font-bold ${
                invoice.status === "outstanding"
                  ? "text-red-600"
                  : "text-green-600"
              }`}
            >
              S${invoice.net_amount.toFixed(2)}
            </Text>
          </View>
        </View>
      </Card>
    </>
  );
}
