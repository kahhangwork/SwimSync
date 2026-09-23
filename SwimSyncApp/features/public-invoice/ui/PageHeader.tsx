// The logo, the business and the invoice's month + children.
// Moved VERBATIM from app/invoice/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Text, View } from "react-native";
import Logo from "@/components/Logo";
import type { PublicInvoice } from "../types";
import { monthLabel } from "../domain/monthLabel";

export function PageHeader(p: { invoice: PublicInvoice }) {
  const { invoice } = p;
  return (
    <>
      <View className="items-center mb-6">
        <Logo size="lg" className="mb-3" />
        <Text className="text-2xl font-bold text-gray-900">
          {invoice.business_name}
        </Text>
        <Text className="text-gray-500 mt-1">
          Invoice · {monthLabel(invoice.billing_month)}
          {invoice.students.length > 0 ? ` · ${invoice.students.join(", ")}` : ""}
        </Text>
      </View>
    </>
  );
}
