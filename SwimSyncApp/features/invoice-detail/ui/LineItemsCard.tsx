// Lesson Breakdown — one line per lesson, marked when a package paid it.
// Moved from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). UI restyle step 3.2: amounts in Ink, tabular; an invoice with no lines
// says so instead of rendering an empty card (BACKLOG S6 — checked first: the
// fixture invoices carry no invoice_items rows, so this is the empty state, not a
// query bug).
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import type { InvoiceDetail } from "../types";
import { formatDate, capitalize } from "../domain/invoiceDetailFormat";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function LineItemsCard(p: { invoice: InvoiceDetail }) {
  const { invoice } = p;
  return (
    <Surface>
      <Text className="text-headline font-semibold text-ink mb-1">
        Lesson Breakdown
      </Text>
      {invoice.items.length === 0 ? (
        <Text className="text-body-secondary text-ink-secondary mt-1">
          No lessons are listed on this invoice.
        </Text>
      ) : (
        <View>
          {invoice.items.map((item, i) => (
            <View
            key={item.id}
            className={`flex-row justify-between gap-3 py-3 ${i > 0 ? "border-t border-divider" : ""}`}
          >
              <View className="flex-1">
                <Text className="text-body text-ink">{item.class_title}</Text>
                <Text className="text-body-secondary text-ink-secondary">
                  {formatDate(item.session_date)} · {item.student_name}
                </Text>
                <Text className="text-body-secondary text-ink-secondary">
                  {capitalize(item.attendance_status)}
                </Text>
                {item.funded_by && (
                  <Text className="text-body-secondary font-medium text-ink-secondary">
                    Paid by package · {item.funded_by}
                  </Text>
                )}
              </View>
              <Text className="text-body text-ink" style={TABULAR}>
                S${item.amount.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Surface>
  );
}
