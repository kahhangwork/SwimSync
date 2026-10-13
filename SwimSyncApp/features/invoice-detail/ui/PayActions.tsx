// Pay via PayNow and the "I've paid" claim, for an outstanding invoice.
// Moved from app/(parent)/billing/invoice/[id].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). UI restyle step 3.2 — DESIGN.md's Pay-First Rule: Pay is the
// full-width primary, the claim a text link beneath it, never an equal button.
import React from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/ui/Button";
import type { InvoiceDetail } from "../types";

export function PayActions(p: { invoice: InvoiceDetail; claiming: boolean; claimPaid: () => void }) {
  const { invoice, claiming, claimPaid } = p;
  if (invoice.status !== "outstanding") return null;
  return (
    <View>
      <Button
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
        <Text className="text-body-secondary text-ink-secondary text-center mt-3">
          You've told your coach this is paid — they'll confirm it.
        </Text>
      ) : (
        <Button
          variant="link"
          label={claiming ? "Saving…" : "I've paid"}
          onPress={claimPaid}
          className="items-center"
        />
      )}
    </View>
  );
}
