// The QR (dynamic, uploaded, or the PayNow ID to type), the reference and the hint line.
// Moved VERBATIM from app/(parent)/billing/paynow.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { usePayNow } from "../domain/usePayNow";

type PayNow = ReturnType<typeof usePayNow>;

export function QrCard(p: Pick<PayNow, "businessName" | "dynamicQr" | "payee" | "showPayableId" | "proxy" | "netAmount" | "reference" | "unconfigured">) {
  const { businessName, dynamicQr, payee, showPayableId, proxy, netAmount, reference, unconfigured } = p;
  return (
    <>
      {/* QR Code */}
      <View className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 items-center mb-6 w-full">
        <Text className="text-sm font-medium text-gray-500 mb-4">
          {businessName ? `${businessName}'s PayNow` : "PayNow"}
        </Text>

        {dynamicQr ? (
          <Image
            source={{ uri: dynamicQr }}
            className="w-52 h-52 rounded-2xl mb-4"
            resizeMode="contain"
          />
        ) : payee?.paynow_qr_url ? (
          <Image
            source={{ uri: payee.paynow_qr_url }}
            className="w-52 h-52 rounded-2xl mb-4"
            resizeMode="contain"
          />
        ) : showPayableId ? (
          /* No QR of either kind, but the business HAS a PayNow ID — so
             the parent can pay by hand. Selectable, because they are going
             to retype it into a banking app. */
          <View className="w-full bg-sky-50 border border-sky-100 rounded-2xl p-4 mb-4">
            <Text className="text-xs text-sky-700 mb-2">
              Transfer to this PayNow ID
            </Text>
            <Text selectable className="text-xl font-bold text-gray-900 mb-3">
              {proxy!.type === "mobile" ? `+65 ${proxy!.value}` : proxy!.value}
            </Text>
            <Text className="text-xs text-sky-700 mb-1">Amount</Text>
            <Text selectable className="text-base font-semibold text-gray-900">
              S${netAmount?.toFixed(2) ?? "—"}
            </Text>
          </View>
        ) : (
          <View className="w-52 h-52 bg-gray-100 rounded-2xl items-center justify-center mb-4">
            <Ionicons name="qr-code-outline" size={80} color="#9ca3af" />
            <Text className="text-xs text-gray-400 mt-2 text-center px-4">
              This business hasn't set up PayNow yet. Ask them to add their
              PayNow ID in SwimSync.
            </Text>
          </View>
        )}

        {reference && (
          <Text selectable className="text-xs text-gray-500 mb-2">
            Reference: {reference}
          </Text>
        )}
        <Text className="text-xs text-gray-400 text-center leading-relaxed">
          {dynamicQr
            ? "Scan with your banking app — the amount and reference are locked into this QR."
            : showPayableId
            ? "Enter the PayNow ID, amount and reference in your banking app."
            : unconfigured
            ? "PayNow is not available for this business yet."
            : "Scan the QR code above with your banking app to make a PayNow transfer. The amount shown above is for reference only."}
        </Text>
      </View>
    </>
  );
}
