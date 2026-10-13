// The QR (dynamic, uploaded, or the PayNow ID to type), the reference and the hint line.
// Moved from app/(parent)/billing/paynow.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); DESIGN.md in UI restyle step 3.3 — flat card, Ink and greys.
import React from "react";
import { View, Text, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import type { usePayNow } from "../domain/usePayNow";

type PayNow = ReturnType<typeof usePayNow>;

export function QrCard(p: Pick<PayNow, "businessName" | "dynamicQr" | "payee" | "showPayableId" | "proxy" | "netAmount" | "reference" | "unconfigured">) {
  const { businessName, dynamicQr, payee, showPayableId, proxy, netAmount, reference, unconfigured } = p;
  return (
    <Surface className="items-center mb-3 w-full">
      <Text className="text-body font-medium text-ink-secondary mb-4">
        {businessName ? `${businessName}'s PayNow` : "PayNow"}
      </Text>

      {dynamicQr ? (
        <Image
          source={{ uri: dynamicQr }}
          className="w-52 h-52 rounded-card mb-4"
          resizeMode="contain"
        />
      ) : payee?.paynow_qr_url ? (
        <Image
          source={{ uri: payee.paynow_qr_url }}
          className="w-52 h-52 rounded-card mb-4"
          resizeMode="contain"
        />
      ) : showPayableId ? (
        /* No QR of either kind, but the business HAS a PayNow ID — so
           the parent can pay by hand. Selectable, because they are going
           to retype it into a banking app. */
        <View className="w-full bg-ground border border-border rounded-card p-4 mb-4">
          <Text className="text-label text-ink-muted mb-1">
            Transfer to this PayNow ID
          </Text>
          <Text selectable className="text-display font-semibold text-ink mb-3">
            {proxy!.type === "mobile" ? `+65 ${proxy!.value}` : proxy!.value}
          </Text>
          <Text className="text-label text-ink-muted mb-1">Amount</Text>
          <Text
            selectable
            className="text-headline font-semibold text-ink"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            S${netAmount?.toFixed(2) ?? "—"}
          </Text>
        </View>
      ) : (
        <View className="w-52 h-52 bg-status-neutral-bg border border-border rounded-card items-center justify-center mb-4">
          <Ionicons name="qr-code-outline" size={80} color="#6b6b6b" />
          <Text className="text-label text-ink-secondary mt-2 text-center px-4">
            This business hasn't set up PayNow yet. Ask them to add their
            PayNow ID in SwimSync.
          </Text>
        </View>
      )}

      {reference && (
        <Text selectable className="text-body-secondary font-medium text-ink mb-2">
          Reference: {reference}
        </Text>
      )}
      <Text className="text-body-secondary text-ink-secondary text-center">
        {dynamicQr
          ? "Scan with your banking app — the amount and reference are locked into this QR."
          : showPayableId
          ? "Enter the PayNow ID, amount and reference in your banking app."
          : unconfigured
          ? "PayNow is not available for this business yet."
          : "Scan the QR code above with your banking app to make a PayNow transfer. The amount shown above is for reference only."}
      </Text>
    </Surface>
  );
}
