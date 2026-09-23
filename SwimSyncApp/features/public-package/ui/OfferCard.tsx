// The amount, terms and reference; the QR only while PENDING (RISK 5); "I've paid".
// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { Image, Text, View } from "react-native";
import PrimaryButton from "@/components/PrimaryButton";
import type { PublicPackage } from "../types";

export function OfferCard(p: { pkg: PublicPackage; startDate: string | null; validUntil: string | null; active: boolean; pending: boolean; qrDataUrl: string | null; saveQr: () => void; claimed: boolean; claiming: boolean; claimPaid: () => void }) {
  const { pkg, startDate, validUntil, active, pending, qrDataUrl, saveQr, claimed, claiming, claimPaid } = p;
  return (
    <>
      <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 items-center mb-6">
        <Text className="text-sm text-gray-500">Amount</Text>
        <Text selectable className="text-4xl font-bold text-gray-900 mt-1 mb-2">
          ${pkg.amount.toFixed(2)}
        </Text>
        {pkg.discount_amount > 0 ? (
          <Text className="text-sm text-emerald-600 mb-1">
            ${pkg.total_value.toFixed(2)} − ${pkg.discount_amount.toFixed(2)} referral discount
          </Text>
        ) : null}
        <Text className="text-sm text-gray-500">
          {pkg.lesson_count} lessons · ${pkg.rate.toFixed(2)} each
        </Text>
        <Text selectable className="text-sm text-gray-500 mt-1">
          Reference: {pkg.reference}
        </Text>
        {startDate ? (
          <Text className="text-sm text-gray-500 mt-1">Starts {startDate}</Text>
        ) : null}
        {validUntil ? (
          <Text className="text-xs text-gray-400 mt-1">
            Valid until at least {validUntil}
          </Text>
        ) : null}

        {active ? (
          <View className="mt-6 bg-emerald-50 rounded-xl px-6 py-4 items-center">
            <Text className="text-emerald-700 font-semibold text-lg">
              Active — thank you!
            </Text>
          </View>
        ) : !pending ? (
          <View className="mt-6 bg-gray-50 rounded-xl px-6 py-4">
            <Text className="text-gray-600 text-center leading-5">
              This offer is no longer available. Please check with your coach.
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
              On your phone? Save the QR, then open your banking app and scan it
              from your photo gallery.
            </Text>
          </>
        ) : (
          <View className="mt-6 bg-amber-50 rounded-xl px-6 py-4">
            <Text className="text-amber-800 text-center leading-5">
              Pay by PayNow using the amount and reference above, or contact your
              coach for payment details.
            </Text>
          </View>
        )}

        {pending &&
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
