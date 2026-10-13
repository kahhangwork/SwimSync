// The summary card: month, business, reference, dates and the money lines.
// Moved from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). UI restyle step 3.2 — Plain Words ("N lessons / Credit / To pay", never
// Gross / Net) and money in Ink with tabular figures. Every amount is the
// invoice's own field, printed as-is: nothing is recomputed here (plan ⚠ RISK 2).
import React from "react";
import { View, Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import { invoiceLabel } from "@/lib/invoiceLabel";
import type { InvoiceDetail } from "../types";
import { formatBillingMonth, formatDate } from "../domain/invoiceDetailFormat";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

function MoneyRow({ label, amount, strong = false }: { label: string; amount: string; strong?: boolean }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className={strong ? "text-headline font-semibold text-ink" : "text-body text-ink-secondary flex-1"}>
        {label}
      </Text>
      <Text className={strong ? "text-headline font-semibold text-ink" : "text-body text-ink"} style={TABULAR}>
        {amount}
      </Text>
    </View>
  );
}

export function SummaryCard(p: { invoice: InvoiceDetail }) {
  const { invoice } = p;
  const n = invoice.items.length;
  return (
    <Surface>
      <Text className="text-headline font-semibold text-ink">
        {formatBillingMonth(invoice.billing_month)}
      </Text>
      <Text className="text-body-secondary text-ink-secondary mt-0.5">
        From {invoice.business_name}
      </Text>
      {/* The reference the parent will actually quote — it is what the QR
          locks in, what the WhatsApp reminder says, and what lands on their
          bank statement. Selectable so it can be copied into a transfer
          made outside the QR. */}
      <Text selectable className="text-body-secondary font-semibold text-ink mt-2">
        {invoiceLabel(invoice)}
      </Text>
      <Text className="text-label text-ink-muted mt-0.5">
        Generated {formatDate(invoice.generated_at)}
        {invoice.paid_at ? ` · Paid ${formatDate(invoice.paid_at)}` : ""}
      </Text>

      <View className="gap-2 mt-4 pt-3 border-t border-divider">
        {/* The count is the lines on this invoice; the amount is the invoice's
            gross. A line-less invoice says "Lessons", never "0 lessons". */}
        <MoneyRow
          label={n > 0 ? `${n} ${n === 1 ? "lesson" : "lessons"}` : "Lessons"}
          amount={`S$${invoice.gross_amount.toFixed(2)}`}
        />
        {invoice.package_applied > 0 && (
          <MoneyRow label="Package" amount={`−S$${invoice.package_applied.toFixed(2)}`} />
        )}
        {invoice.credit_applied > 0 && (
          <MoneyRow label="Credit" amount={`−S$${invoice.credit_applied.toFixed(2)}`} />
        )}
        {invoice.balance_adjustment > 0 && (
          <MoneyRow
            label="Adjustment from a prior invoice"
            amount={`+S$${invoice.balance_adjustment.toFixed(2)}`}
          />
        )}
        <View className="pt-2 border-t border-divider">
          <MoneyRow
            label={invoice.status === "outstanding" ? "To pay" : "Total"}
            amount={`S$${invoice.net_amount.toFixed(2)}`}
            strong
          />
        </View>
      </View>
    </Surface>
  );
}
