// Pay via PayNow and the "I've paid" claim, for an outstanding invoice.
// Moved VERBATIM from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import type { InvoiceDetail } from "../types";

export function PayActions(p: { invoice: InvoiceDetail; claiming: boolean; claimPaid: () => void }) {
  const { invoice, claiming, claimPaid } = p;
  return (
    <>
      {/* PayNow CTA */}
      {invoice.status === "outstanding" && (
        <View className="gap-3">
          <PrimaryButton
            label="Pay via PayNow QR"
            onPress={() =>
              router.push(
                `/(parent)/billing/paynow?invoiceId=${invoice.id}&coachId=${invoice.coach_id ?? ""}`
              )
            }
          />
          {/* A CLAIM, not a status change — the coach confirms against
              their bank. Idempotent server-side; first timestamp wins. */}
          {invoice.paid_claimed_at ? (
            <Text className="text-sm text-sky-700 text-center">
              You've told your coach this is paid — they'll confirm it.
            </Text>
          ) : (
            <PrimaryButton
              label={claiming ? "Saving…" : "I've paid"}
              variant="outline"
              onPress={claimPaid}
            />
          )}
        </View>
      )}
    </>
  );
}
