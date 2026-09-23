// PayNow QR: the PayNow-ID status and the always-reachable fallback-image upload.
// Moved VERBATIM from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function PayNowQrCard(p: Pick<Settings, "hasPaynowId" | "showQrUpload" | "setShowQrUpload" | "paynowUrl" | "uploading" | "handleUploadQR">) {
  const { hasPaynowId, showQrUpload, setShowQrUpload, paynowUrl, uploading, handleUploadQR } = p;
  return (
    <>
      {/* PayNow QR Management */}
      <Card className="mb-4">
        <View className="flex-row items-center gap-2 mb-4">
          <Ionicons name="qr-code-outline" size={20} color="#0ea5e9" />
          <Text className="text-base font-bold text-gray-900">
            PayNow QR Code
          </Text>
        </View>

        {hasPaynowId ? (
          <View className="bg-green-50 rounded-xl p-3 mb-4">
            <Text className="text-sm text-green-700">
              Your PayNow ID is set. Parents get a QR with the amount and
              reference already filled in, so payments arrive matched to the
              right bill.
            </Text>
          </View>
        ) : (
          <View className="bg-yellow-50 rounded-xl p-3 mb-4">
            <Text className="text-sm text-yellow-700">
              No PayNow ID set yet. Add your PayNow UEN or mobile in the admin
              panel (Invoices → PayNow) and parents get a QR with the amount
              and reference filled in automatically.
            </Text>
          </View>
        )}

        {/* The uploaded image. ALWAYS present, never conditionally removed —
            it is the only writer of tenants.paynow_qr_url anywhere in the
            product, and it is the last resort for native builds and for a
            PayNow ID that cannot be encoded. Collapsed, so it stops being
            the primary affordance without becoming unreachable. */}
        <TouchableOpacity
          onPress={() => setShowQrUpload((v) => !v)}
          className="flex-row items-center gap-1 py-1"
          activeOpacity={0.7}
        >
          <Ionicons
            name={showQrUpload ? "chevron-down" : "chevron-forward"}
            size={14}
            color="#6b7280"
          />
          <Text className="text-xs text-gray-500">
            Fallback QR image — advanced
          </Text>
        </TouchableOpacity>

        {showQrUpload && (
          <View className="mt-3">
            <Text className="text-xs text-gray-500 mb-3">
              Used only when a PayNow ID is not set or cannot be turned into a
              QR. The amount and reference are not filled in, so parents type
              them by hand.
            </Text>

            {paynowUrl ? (
              <View className="items-center mb-4">
                <Image
                  source={{ uri: paynowUrl }}
                  className="w-36 h-36 rounded-2xl mb-3"
                  resizeMode="contain"
                />
                <Text className="text-xs text-gray-500">
                  Parents see this when no PayNow ID QR can be built.
                </Text>
              </View>
            ) : null}

            <PrimaryButton
              label={
                uploading
                  ? "Uploading…"
                  : paynowUrl
                  ? "Replace QR Code"
                  : "Upload QR Code"
              }
              variant="outline"
              onPress={handleUploadQR}
            />
          </View>
        )}
      </Card>
    </>
  );
}
