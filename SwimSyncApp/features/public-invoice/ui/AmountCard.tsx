// Amount due, the reference, the QR (or the paid / manual state) and "I've paid".
// Moved VERBATIM from app/invoice/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
//
// UI restyle step 4.5 (DESIGN.md): a flat card; the amount written S$88.00 in
// tabular figures (it was a bare "$88.00" — Aligned Money); Pay-First — "Save QR
// image" is the one primary and "I've paid" a text link beneath it, never an
// equal button; after a claim the line is Info, and Paid is Success. No figure is
// recomputed and no condition changed — paid / claimed / qrDataUrl are the page's.
import React from "react";
import { Image, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { PublicInvoice } from "../types";
import { formatSgd } from "@/lib/money";

export function AmountCard(p: { invoice: PublicInvoice; paid: boolean; qrDataUrl: string | null; saveQr: () => void; claimed: boolean; claiming: boolean; claimPaid: () => void }) {
  const { invoice, paid, qrDataUrl, saveQr, claimed, claiming, claimPaid } = p;
  return (
    <>
      <Surface className="items-center mb-6">
        <Text className="text-body-secondary text-ink-secondary">Amount due</Text>
        <Text
          selectable
          className="text-display font-semibold text-ink mt-1 mb-2"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {formatSgd(invoice.amount)}
        </Text>
        <Text selectable className="text-body-secondary text-ink-secondary">
          Reference: {invoice.reference}
        </Text>

        {paid ? (
          <View className="mt-5 w-full bg-status-success-bg border border-status-success-border rounded-card px-4 py-3 items-center">
            <Text className="text-headline font-semibold text-status-success-text">
              Paid — thank you!
            </Text>
          </View>
        ) : qrDataUrl ? (
          <>
            <Image
              source={{ uri: qrDataUrl }}
              className="w-56 h-56 mt-5"
              resizeMode="contain"
            />
            <Text className="text-label text-ink-muted mb-4">
              PayNow · amount and reference are locked in
            </Text>
            <Button label="Save QR image" onPress={saveQr} className="w-full" />
            <Text className="text-body-secondary text-ink-secondary text-center mt-3">
              On your phone? Save the QR, then open your banking app and scan
              it from your photo gallery.
            </Text>
          </>
        ) : (
          <View className="mt-5 w-full bg-ground border border-border rounded-card px-4 py-3">
            <Text className="text-body text-ink text-center">
              Pay by PayNow using the amount and reference above, or contact
              your coach for payment details.
            </Text>
          </View>
        )}

        {!paid &&
          (claimed ? (
            <View className="mt-4 w-full bg-status-info-bg border border-status-info-border rounded-card px-4 py-3">
              <Text className="text-body text-status-info-text text-center">
                You've told us this is paid — your coach will confirm it.
              </Text>
            </View>
          ) : (
            <Button
              label={claiming ? "Saving…" : "I've paid"}
              variant="link"
              onPress={claimPaid}
              className="mt-2 items-center w-full"
            />
          ))}
      </Surface>
    </>
  );
}
