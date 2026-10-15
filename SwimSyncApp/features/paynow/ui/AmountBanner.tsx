// The amount to pay, with the billing month or package name.
// Moved from app/(parent)/billing/paynow.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). UI restyle step 3.3: a plain card, the amount in Ink — an amount to
// pay is not an alarm (DESIGN.md's Red Means Stuck Rule). The figure is the
// hook's, printed as-is.
import React from "react";
import { Text } from "react-native";
import { Surface } from "@/components/ui/Surface";
import type { usePayNow } from "../domain/usePayNow";
import { formatSgd } from "@/lib/money";

type PayNow = ReturnType<typeof usePayNow>;

export function AmountBanner(p: Pick<PayNow, "netAmount" | "billingMonth" | "packageName">) {
  const { netAmount, billingMonth, packageName } = p;
  if (netAmount === null) return null;
  return (
    <Surface className="w-full mb-3 items-center">
      <Text className="text-body-secondary text-ink-secondary">To pay</Text>
      <Text
        className="text-display font-semibold text-ink mt-0.5"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {formatSgd(netAmount)}
      </Text>
      {billingMonth && (
        <Text className="text-body-secondary text-ink-secondary mt-1">{billingMonth}</Text>
      )}
      {packageName && (
        <Text className="text-body-secondary text-ink-secondary mt-1">{packageName}</Text>
      )}
    </Surface>
  );
}
