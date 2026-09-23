// Amount due, the reference, the QR (or the paid / manual state) and "I've paid".
// Moved VERBATIM from app/invoice/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Image, Text, View } from "react-native";
import PrimaryButton from "@/components/PrimaryButton";
import type { PublicInvoice } from "../types";

export function AmountCard(p: { invoice: PublicInvoice; paid: boolean; qrDataUrl: string | null; saveQr: () => void; claimed: boolean; claiming: boolean; claimPaid: () => void }) {
  const { invoice, paid, qrDataUrl, saveQr, claimed, claiming, claimPaid } = p;
  return (
    <>
      <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 items-center mb-6">
        <Text className="text-sm text-gray-500">Amount due</Text>
        <Text
          selectable
          className="text-4xl font-bold text-gray-900 mt-1 mb-2"
        >
          ${invoice.amount.toFixed(2)}
        </Text>
        <Text selectable className="text-sm text-gray-500">
          Reference: {invoice.reference}
        </Text>

        {paid ? (
          <View className="mt-6 bg-emerald-50 rounded-xl px-6 py-4 items-center">
            <Text className="text-emerald-700 font-semibold text-lg">
              Paid — thank you!
            </Text>
          </View>
        ) : qrDataUrl ? (
          <>
            <Image
              source={{ uri: qrDataUrl }}
              className="w-56 h-56 mt-6"
              resizeMode="contain"
            />
            <Text className="text-xs text-gray-400 mb-4">
              PayNow · amount and reference are locked in
            </Text>
            <PrimaryButton label="Save QR image" onPress={saveQr} />
            <Text className="text-sm text-gray-500 text-center mt-3 leading-5">
              On your phone? Save the QR, then open your banking app and scan
              it from your photo gallery.
            </Text>
          </>
        ) : (
          <View className="mt-6 bg-amber-50 rounded-xl px-6 py-4">
            <Text className="text-amber-800 text-center leading-5">
              Pay by PayNow using the amount and reference above, or contact
              your coach for payment details.
            </Text>
          </View>
        )}

        {!paid &&
          (claimed ? (
            <Text className="text-sm text-sky-700 mt-4">
              You've told us this is paid — your coach will confirm it.
            </Text>
          ) : (
            <View className="mt-4 w-full">
              <PrimaryButton
                label={claiming ? "Saving…" : "I've paid"}
                variant="outline"
                onPress={claimPaid}
              />
            </View>
          ))}
      </View>
    </>
  );
}
