// The logo, the business and the invoice's month + children.
// Moved VERBATIM from app/invoice/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside). Restyled in UI restyle step 4.5 (Display title).
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
        <Text className="text-display font-semibold text-ink text-center">
          {invoice.business_name}
        </Text>
        <Text className="text-body text-ink-secondary mt-1 text-center">
          Invoice · {monthLabel(invoice.billing_month)}
          {invoice.students.length > 0 ? ` · ${invoice.students.join(", ")}` : ""}
        </Text>
      </View>
    </>
  );
}
