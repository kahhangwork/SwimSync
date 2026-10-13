// Credit Notes Applied, when there are any.
// Moved from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). UI restyle step 3.2: a credit is Ink with a true minus, never link-blue.
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import type { InvoiceDetail } from "../types";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function CreditNotesCard(p: { invoice: InvoiceDetail }) {
  const { invoice } = p;
  if (invoice.credit_notes.length === 0) return null;
  return (
    <Surface>
      <Text className="text-headline font-semibold text-ink mb-1">
        Credit Notes Applied
      </Text>
      <View>
        {invoice.credit_notes.map((cn, i) => (
          <View
            key={cn.id}
            className={`flex-row justify-between gap-3 py-3 ${i > 0 ? "border-t border-divider" : ""}`}
          >
            <View className="flex-1">
              <Text className="text-body text-ink">{cn.reference_number}</Text>
              {cn.reason ? (
                <Text className="text-body-secondary text-ink-secondary">{cn.reason}</Text>
              ) : null}
            </View>
            <Text className="text-body text-ink" style={TABULAR}>
              −S${cn.amount.toFixed(2)}
            </Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}
